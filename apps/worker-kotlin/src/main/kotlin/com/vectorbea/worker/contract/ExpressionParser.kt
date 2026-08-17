package com.vectorbea.worker.contract

/**
 * A tiny expression language for contract assertions — and, more importantly, one
 * that **cannot execute code**.
 *
 * WHY NOT A SCRIPT ENGINE
 * -----------------------
 * The obvious implementation is Nashorn, Rhino, Groovy or JEXL: a few lines,
 * every feature for free. It is also arbitrary code execution, authored by a
 * customer, running inside the worker that holds every other customer's
 * credentials and database connections. Sandboxing a real script engine well
 * enough to survive that is a research project; sandboxing one badly is a breach.
 *
 * So this is a hand-written recursive-descent parser over a deliberately small
 * grammar. There is no function-call syntax except a fixed allow-list, no property
 * access outside the four supplied roots, no loops, no assignment, and no way to
 * reach a JVM class. The worst a malicious expression can do is be false.
 *
 * THE GRAMMAR
 * -----------
 * ```
 *   expr        := implication
 *   implication := or ( "implies" or )*          // right-associative
 *   or          := and ( ("or" | "||") and )*
 *   and         := not ( ("and" | "&&") not )*
 *   not         := ("not" | "!") not | comparison
 *   comparison  := additive ( ("==" | "!=" | "<" | "<=" | ">" | ">=" | "in"
 *                             | "matches" | "contains" | "startsWith" | "endsWith") additive )?
 *   additive    := multiplicative ( ("+" | "-") multiplicative )*
 *   multiplicative := unary ( ("*" | "/" | "%") unary )*
 *   unary       := "-" unary | primary
 *   primary     := literal | call | path | "(" expr ")"
 *   call        := IDENT "(" ( expr ("," expr)* )? ")"
 *   path        := IDENT ( "." IDENT | "[" (INT | "*") "]" )*
 * ```
 *
 * `implies` is the one non-obvious operator and it is in §4's example for a reason:
 * `output.risk_score > 70 implies output.recommendation != "no_action"` is exactly
 * how a business rule is stated in English, and writing it as
 * `!(a) || b` is a translation the author has to get right every time.
 *
 * `[*]` projects across an array — `input.accounts[*].id` yields every id — which
 * is what makes the membership assertion in §4 expressible at all.
 */
object ExpressionParser {

    /** Thrown for a malformed expression. Carries the position so the UI can point at it. */
    class ParseException(message: String, val position: Int) :
        RuntimeException("$message (at character $position)")

    // ── AST ─────────────────────────────────────────────────────────────────

    sealed class Node {
        data class Literal(val value: Any?) : Node()
        /** A path from one of the four roots: input, output, stats, context. */
        data class Path(val segments: List<Segment>) : Node()
        data class Binary(val op: String, val left: Node, val right: Node) : Node()
        data class Unary(val op: String, val operand: Node) : Node()
        data class Call(val name: String, val args: List<Node>) : Node()
    }

    sealed class Segment {
        data class Field(val name: String) : Segment()
        data class Index(val i: Int) : Segment()
        /** `[*]` — project across every element. */
        object Wildcard : Segment()
    }

    /**
     * Functions an expression may call.
     *
     * An allow-list, not a deny-list. Anything not named here is a parse error, so
     * adding a capability is a deliberate act rather than an oversight.
     */
    val ALLOWED_FUNCTIONS = setOf(
        // Arithmetic / aggregate
        "abs", "min", "max", "round", "floor", "ceil", "sum", "avg",
        // Collections
        "count", "any", "all", "length", "unique",
        // Strings
        "lower", "upper", "trim",
        // Null handling — the assertion author's most common need
        "isNull", "isNotNull", "coalesce",
        // Types
        "isNumber", "isString", "isBoolean", "isArray", "isObject",
    )

    private val ROOTS = setOf("input", "output", "stats", "context")

    fun parse(source: String): Node {
        val tokens = Lexer(source).tokenize()
        val parser = Parser(tokens, source)
        val node = parser.parseExpression()
        parser.expectEnd()
        return node
    }

    /** Parse without evaluating — for the UI's live validation. */
    fun validate(source: String): String? =
        try { parse(source); null } catch (e: ParseException) { e.message } catch (e: Exception) { e.message }

    // ── Lexer ───────────────────────────────────────────────────────────────

    private data class Token(val type: Type, val text: String, val pos: Int) {
        enum class Type { IDENT, NUMBER, STRING, OPERATOR, LPAREN, RPAREN, LBRACKET, RBRACKET, DOT, COMMA, END }
    }

    private class Lexer(private val src: String) {
        private var i = 0

        fun tokenize(): List<Token> {
            val out = mutableListOf<Token>()
            while (i < src.length) {
                val c = src[i]
                when {
                    c.isWhitespace() -> i++
                    c.isDigit() -> out += number()
                    c == '"' || c == '\'' -> out += string(c)
                    c.isLetter() || c == '_' -> out += ident()
                    c == '(' -> { out += Token(Token.Type.LPAREN, "(", i); i++ }
                    c == ')' -> { out += Token(Token.Type.RPAREN, ")", i); i++ }
                    c == '[' -> { out += Token(Token.Type.LBRACKET, "[", i); i++ }
                    c == ']' -> { out += Token(Token.Type.RBRACKET, "]", i); i++ }
                    c == '.' -> { out += Token(Token.Type.DOT, ".", i); i++ }
                    c == ',' -> { out += Token(Token.Type.COMMA, ",", i); i++ }
                    c == '*' && out.lastOrNull()?.type == Token.Type.LBRACKET -> {
                        out += Token(Token.Type.IDENT, "*", i); i++
                    }
                    else -> out += operator()
                }
            }
            out += Token(Token.Type.END, "", src.length)
            return out
        }

        private fun number(): Token {
            val start = i
            while (i < src.length && (src[i].isDigit() || src[i] == '.')) i++
            return Token(Token.Type.NUMBER, src.substring(start, i), start)
        }

        private fun string(quote: Char): Token {
            val start = i
            i++
            val sb = StringBuilder()
            while (i < src.length && src[i] != quote) {
                if (src[i] == '\\' && i + 1 < src.length) { i++; sb.append(unescape(src[i])) }
                else sb.append(src[i])
                i++
            }
            if (i >= src.length) throw ParseException("Unterminated string", start)
            i++
            return Token(Token.Type.STRING, sb.toString(), start)
        }

        private fun unescape(c: Char) = when (c) {
            'n' -> '\n'; 't' -> '\t'; 'r' -> '\r'; else -> c
        }

        private fun ident(): Token {
            val start = i
            while (i < src.length && (src[i].isLetterOrDigit() || src[i] == '_')) i++
            val text = src.substring(start, i)
            // Word operators are lexed as operators so the parser does not have to
            // special-case identifiers that happen to be keywords.
            return if (text in WORD_OPERATORS) Token(Token.Type.OPERATOR, text, start)
                   else Token(Token.Type.IDENT, text, start)
        }

        private fun operator(): Token {
            val start = i
            for (op in MULTI_CHAR_OPERATORS) {
                if (src.startsWith(op, i)) { i += op.length; return Token(Token.Type.OPERATOR, op, start) }
            }
            val c = src[i]
            if (c in SINGLE_CHAR_OPERATORS) { i++; return Token(Token.Type.OPERATOR, c.toString(), start) }
            throw ParseException("Unexpected character '$c'", start)
        }

        private companion object {
            val WORD_OPERATORS = setOf("and", "or", "not", "in", "implies",
                "matches", "contains", "startsWith", "endsWith", "true", "false", "null")
            // Longest first: "<=" must not lex as "<" then "=".
            val MULTI_CHAR_OPERATORS = listOf("==", "!=", "<=", ">=", "&&", "||")
            val SINGLE_CHAR_OPERATORS = setOf('<', '>', '+', '-', '*', '/', '%', '!')
        }
    }

    // ── Parser ──────────────────────────────────────────────────────────────

    private class Parser(private val tokens: List<Token>, private val src: String) {
        private var pos = 0

        private fun peek() = tokens[pos]
        private fun advance() = tokens[pos++]
        private fun check(type: Token.Type, text: String? = null) =
            peek().type == type && (text == null || peek().text == text)

        fun expectEnd() {
            if (!check(Token.Type.END)) {
                throw ParseException("Unexpected '${peek().text}' after the end of the expression", peek().pos)
            }
        }

        fun parseExpression(): Node = implication()

        /**
         * `a implies b` — right-associative, so `a implies b implies c` reads as
         * `a implies (b implies c)`, matching how the English chains.
         */
        private fun implication(): Node {
            val left = or()
            if (check(Token.Type.OPERATOR, "implies")) {
                advance()
                return Node.Binary("implies", left, implication())
            }
            return left
        }

        private fun or(): Node {
            var left = and()
            while (check(Token.Type.OPERATOR, "or") || check(Token.Type.OPERATOR, "||")) {
                advance(); left = Node.Binary("or", left, and())
            }
            return left
        }

        private fun and(): Node {
            var left = not()
            while (check(Token.Type.OPERATOR, "and") || check(Token.Type.OPERATOR, "&&")) {
                advance(); left = Node.Binary("and", left, not())
            }
            return left
        }

        private fun not(): Node {
            if (check(Token.Type.OPERATOR, "not") || check(Token.Type.OPERATOR, "!")) {
                advance(); return Node.Unary("not", not())
            }
            return comparison()
        }

        private fun comparison(): Node {
            val left = additive()
            val t = peek()
            if (t.type == Token.Type.OPERATOR && t.text in COMPARISONS) {
                advance()
                return Node.Binary(t.text, left, additive())
            }
            return left
        }

        private fun additive(): Node {
            var left = multiplicative()
            while (check(Token.Type.OPERATOR, "+") || check(Token.Type.OPERATOR, "-")) {
                val op = advance().text
                left = Node.Binary(op, left, multiplicative())
            }
            return left
        }

        private fun multiplicative(): Node {
            var left = unary()
            while (check(Token.Type.OPERATOR, "*") || check(Token.Type.OPERATOR, "/") ||
                   check(Token.Type.OPERATOR, "%")) {
                val op = advance().text
                left = Node.Binary(op, left, unary())
            }
            return left
        }

        private fun unary(): Node {
            if (check(Token.Type.OPERATOR, "-")) { advance(); return Node.Unary("-", unary()) }
            return primary()
        }

        private fun primary(): Node {
            val t = peek()
            return when {
                t.type == Token.Type.NUMBER -> {
                    advance()
                    Node.Literal(t.text.toDoubleOrNull()
                        ?: throw ParseException("Invalid number '${t.text}'", t.pos))
                }
                t.type == Token.Type.STRING -> { advance(); Node.Literal(t.text) }
                t.type == Token.Type.OPERATOR && t.text == "true" -> { advance(); Node.Literal(true) }
                t.type == Token.Type.OPERATOR && t.text == "false" -> { advance(); Node.Literal(false) }
                t.type == Token.Type.OPERATOR && t.text == "null" -> { advance(); Node.Literal(null) }
                t.type == Token.Type.LPAREN -> {
                    advance()
                    val inner = parseExpression()
                    if (!check(Token.Type.RPAREN)) throw ParseException("Expected ')'", peek().pos)
                    advance()
                    inner
                }
                t.type == Token.Type.IDENT -> {
                    // A function call, or a path. Decided by the next token.
                    if (tokens.getOrNull(pos + 1)?.type == Token.Type.LPAREN) call() else path()
                }
                else -> throw ParseException("Expected a value but found '${t.text}'", t.pos)
            }
        }

        private fun call(): Node {
            val name = advance().text
            if (name !in ALLOWED_FUNCTIONS) {
                // The allow-list is the security boundary; the message names the
                // alternatives so the author is not left guessing.
                throw ParseException(
                    "Unknown function '$name'. Available: ${ALLOWED_FUNCTIONS.sorted().joinToString(", ")}",
                    peek().pos)
            }
            advance() // (
            val args = mutableListOf<Node>()
            if (!check(Token.Type.RPAREN)) {
                args += parseExpression()
                while (check(Token.Type.COMMA)) { advance(); args += parseExpression() }
            }
            if (!check(Token.Type.RPAREN)) throw ParseException("Expected ')' to close $name(", peek().pos)
            advance()
            return Node.Call(name, args)
        }

        private fun path(): Node {
            val first = advance()
            if (first.text !in ROOTS) {
                // Paths may only start from a supplied root. This is what makes
                // "no property access outside the four roots" true rather than
                // aspirational.
                throw ParseException(
                    "'${first.text}' is not available. Expressions may reference: ${ROOTS.sorted().joinToString(", ")}",
                    first.pos)
            }
            val segments = mutableListOf<Segment>(Segment.Field(first.text))
            while (true) {
                when {
                    check(Token.Type.DOT) -> {
                        advance()
                        if (peek().type != Token.Type.IDENT) {
                            throw ParseException("Expected a field name after '.'", peek().pos)
                        }
                        segments += Segment.Field(advance().text)
                    }
                    check(Token.Type.LBRACKET) -> {
                        advance()
                        val t = advance()
                        segments += when {
                            t.text == "*" -> Segment.Wildcard
                            t.type == Token.Type.NUMBER -> Segment.Index(t.text.toDouble().toInt())
                            else -> throw ParseException("Expected an index or '*' inside []", t.pos)
                        }
                        if (!check(Token.Type.RBRACKET)) throw ParseException("Expected ']'", peek().pos)
                        advance()
                    }
                    else -> break
                }
            }
            return Node.Path(segments)
        }

        private companion object {
            val COMPARISONS = setOf("==", "!=", "<", "<=", ">", ">=",
                "in", "matches", "contains", "startsWith", "endsWith")
        }
    }
}
