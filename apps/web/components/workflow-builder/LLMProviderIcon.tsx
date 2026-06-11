/**
 * LLMProviderIcon — brand SVG icons + metadata for each supported LLM provider.
 *
 * Provider detection is done by normalizing the `provider` or `modelName`
 * field to lowercase and substring-matching against each entry's `matches` list.
 *
 * Used by AgentNode and LlmNode in the workflow builder to display provider logos.
 */

import React from "react";

// ─── SVG icon components ──────────────────────────────────────────────────────

function OpenAIIcon({ size = 20 }: { size?: number }) {
  // OpenAI logo — simplified knot / asterisk on black
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#000000" />
      <path
        d="M22 12a10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2a10 10 0 0 1 10 10"
        stroke="none"
      />
      {/* OpenAI six-lobed knot — approximated as 3 ellipses rotated */}
      <g fill="white">
        <path d="M12 4.5c-.6 0-1.1.5-1.1 1.1v1.7c0 .6.5 1.1 1.1 1.1s1.1-.5 1.1-1.1V5.6c0-.6-.5-1.1-1.1-1.1Z" />
        <path d="M12 15.6c-.6 0-1.1.5-1.1 1.1v1.7c0 .6.5 1.1 1.1 1.1s1.1-.5 1.1-1.1v-1.7c0-.6-.5-1.1-1.1-1.1Z" />
        <path d="M7.1 7.5c-.5.3-.7.9-.4 1.4l.9 1.5c.3.5.9.7 1.4.4.5-.3.7-.9.4-1.4L8.5 7.9c-.3-.5-.9-.7-1.4-.4Z" />
        <path d="M14.9 13.1c-.5.3-.7.9-.4 1.4l.9 1.5c.3.5.9.7 1.4.4.5-.3.7-.9.4-1.4l-.9-1.5c-.3-.5-.9-.7-1.4-.4Z" />
        <path d="M7.1 16.5c-.5-.3-1.1-.1-1.4.4l-.9 1.5c-.3.5-.1 1.1.4 1.4.5.3 1.1.1 1.4-.4l.9-1.5c.3-.5.1-1.1-.4-1.4Z" />
        <path d="M16.9 6.2c-.5-.3-1.1-.1-1.4.4l-.9 1.5c-.3.5-.1 1.1.4 1.4.5.3 1.1.1 1.4-.4l.9-1.5c.3-.5.1-1.1-.4-1.4Z" />
        <circle cx="12" cy="12" r="2.2" fill="white" />
      </g>
    </svg>
  );
}

function AnthropicIcon({ size = 20 }: { size?: number }) {
  // Anthropic / Claude — warm dark bg, angular "A" shape
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#CC785C" />
      {/* Stylized A that echoes Anthropic's identity */}
      <path
        d="M8.5 17L12 7l3.5 10M9.8 13.5h4.4"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GoogleIcon({ size = 20 }: { size?: number }) {
  // Google / Gemini — white bg with classic Google-colored "G"
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#FFFFFF" />
      <path
        d="M12 11h5.5a5.5 5.5 0 1 1-1.6-4.1"
        stroke="none"
      />
      <path d="M19.5 11H12v2h5.8a5.5 5.5 0 1 1-1.5-5.5" fill="none" />
      {/* G shape with Google colors */}
      <path d="M12 6a6 6 0 1 0 5.6 8.1H12v-2.1h7.4c.1.6.2 1.3.2 2a7.5 7.5 0 1 1-2.2-5.3" fill="#4285F4" />
      <path d="M12 6a6 6 0 0 0-6 6h2.5A3.5 3.5 0 0 1 12 8.5V6Z" fill="#34A853" />
      <path d="M6 12a6 6 0 0 0 6 6v-2.5A3.5 3.5 0 0 1 8.5 12H6Z" fill="#FBBC05" />
      <path d="M12 18a6 6 0 0 0 5.7-4H12v-2h7.4A7.5 7.5 0 0 1 4.5 12H6a6 6 0 0 0 6 6Z" fill="#EA4335" />
    </svg>
  );
}

function GeminiIcon({ size = 20 }: { size?: number }) {
  // Google Gemini — gradient star shape
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#1A1A2E" />
      <defs>
        <linearGradient id="gemini-grad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9C59D1" />
          <stop offset="1" stopColor="#EA4335" />
        </linearGradient>
      </defs>
      {/* Gemini 4-pointed star */}
      <path
        d="M12 4C12 4 13.5 9 14.8 10.2C16 11.5 20 12 20 12C20 12 16 12.5 14.8 13.8C13.5 15 12 20 12 20C12 20 10.5 15 9.2 13.8C8 12.5 4 12 4 12C4 12 8 11.5 9.2 10.2C10.5 9 12 4 12 4Z"
        fill="url(#gemini-grad)"
      />
    </svg>
  );
}

function MetaIcon({ size = 20 }: { size?: number }) {
  // Meta / Llama — Meta blue with infinity/M shape
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#0866FF" />
      <defs>
        <linearGradient id="meta-grad" x1="4" y1="12" x2="20" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0099FF" />
          <stop offset="1" stopColor="#A033FF" />
        </linearGradient>
      </defs>
      {/* Meta infinity / ∞ loop */}
      <path
        d="M4.5 12c0-2 1.4-3.5 3.2-3.5 1.3 0 2.2.8 3.3 2.3.7 1 1.1 1.7 2 2.8 1 1.2 1.9 1.9 3 1.9 1.8 0 3.2-1.4 3.2-3.5S17.8 8.5 16 8.5c-1.1 0-2 .7-3 1.9-.3.4-.6.8-1 1.4-.4-.6-.7-1-1-1.4C9.9 9.2 8.9 8.5 7.7 8.5 5.9 8.5 4.5 9.9 4.5 12Z"
        stroke="white"
        strokeWidth="1.7"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MistralIcon({ size = 20 }: { size?: number }) {
  // Mistral AI — orange brand color with M/wave shape
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#FF7000" />
      {/* Stylized Mistral blocks (their logo uses block/pixel art style) */}
      <rect x="4" y="4" width="5" height="5" rx="1" fill="white" />
      <rect x="10" y="4" width="5" height="5" rx="1" fill="white" opacity="0.7" />
      <rect x="15" y="4" width="5" height="5" rx="1" fill="white" />
      <rect x="4" y="10" width="5" height="5" rx="1" fill="white" opacity="0.7" />
      <rect x="10" y="10" width="5" height="5" rx="1" fill="white" />
      <rect x="4" y="15" width="5" height="5" rx="1" fill="white" />
      <rect x="15" y="15" width="5" height="5" rx="1" fill="white" opacity="0.7" />
    </svg>
  );
}

function CohereIcon({ size = 20 }: { size?: number }) {
  // Cohere — coral brand color with C/circle shape
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#39594D" />
      {/* Cohere uses concentric arcs */}
      <circle cx="12" cy="12" r="5.5" stroke="white" strokeWidth="1.6" fill="none" />
      <circle cx="12" cy="12" r="2.5" fill="white" />
      <path d="M12 4V6.5M12 17.5V20M4 12H6.5M17.5 12H20" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function DeepSeekIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#4D6BFE" />
      {/* Stylized "D" with sea wave */}
      <path
        d="M7 7h4.5a5 5 0 0 1 0 10H7V7Z"
        stroke="white"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
      <path d="M10 14.5c1.5 1 3.5.5 4-1" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GroqIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#F55036" />
      <path
        d="M12 6a6 6 0 1 0 6 6h-6V6Z"
        stroke="white"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GrokIcon({ size = 20 }: { size?: number }) {
  // xAI / Grok — dark with X
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#000000" />
      <path d="M7 7L17 17M17 7L7 17" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AzureOpenAIIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#0078D4" />
      <path d="M5 17L9 7l3.5 5.5L16 7l3 10" stroke="white" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function VertexAIIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#1A73E8" />
      <path d="M12 5L19 18H5L12 5Z" stroke="white" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <circle cx="12" cy="14" r="1.5" fill="white" />
    </svg>
  );
}

function GenericLLMIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="6" fill="#7C3AED" />
      <path d="M6 9h12M6 12h8M6 15h10" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17" cy="15" r="2.5" fill="#A78BFA" stroke="white" strokeWidth="1" />
    </svg>
  );
}

// ─── Provider metadata ────────────────────────────────────────────────────────

export interface LLMProviderMeta {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  Icon: React.ComponentType<{ size?: number }>;
  /** Lowercase substrings to match against provider/model strings */
  matches: string[];
}

export const LLM_PROVIDERS: LLMProviderMeta[] = [
  {
    label: "OpenAI",
    color: "#000000",
    bgColor: "#F9F9F9",
    borderColor: "#D1D5DB",
    Icon: OpenAIIcon,
    matches: ["openai", "gpt-4", "gpt-3", "gpt4", "gpt3", "o1", "o3", "davinci", "turbo"],
  },
  {
    label: "Claude",
    color: "#CC785C",
    bgColor: "#FDF4EF",
    borderColor: "#F5C9B5",
    Icon: AnthropicIcon,
    matches: ["anthropic", "claude", "claude-3", "claude-2", "haiku", "sonnet", "opus"],
  },
  {
    label: "Gemini",
    color: "#4285F4",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    Icon: GeminiIcon,
    matches: ["gemini", "gemini-pro", "gemini-flash", "gemini-ultra"],
  },
  {
    label: "Google",
    color: "#4285F4",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    Icon: GoogleIcon,
    matches: ["google", "palm", "palm2", "bison", "text-bison"],
  },
  {
    label: "Vertex AI",
    color: "#1A73E8",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    Icon: VertexAIIcon,
    matches: ["vertex", "vertexai", "vertex-ai"],
  },
  {
    label: "Llama",
    color: "#0866FF",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    Icon: MetaIcon,
    matches: ["meta", "llama", "llama-2", "llama-3", "llama3", "llama2", "codellama"],
  },
  {
    label: "Mistral",
    color: "#FF7000",
    bgColor: "#FFF7ED",
    borderColor: "#FED7AA",
    Icon: MistralIcon,
    matches: ["mistral", "mixtral", "mistral-7b", "mistral-large", "mistral-small", "codestral"],
  },
  {
    label: "Cohere",
    color: "#39594D",
    bgColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    Icon: CohereIcon,
    matches: ["cohere", "command-r", "command", "coral"],
  },
  {
    label: "DeepSeek",
    color: "#4D6BFE",
    bgColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    Icon: DeepSeekIcon,
    matches: ["deepseek", "deep-seek"],
  },
  {
    label: "Groq",
    color: "#F55036",
    bgColor: "#FEF2F2",
    borderColor: "#FECACA",
    Icon: GroqIcon,
    matches: ["groq"],
  },
  {
    label: "Grok / xAI",
    color: "#000000",
    bgColor: "#F9FAFB",
    borderColor: "#E5E7EB",
    Icon: GrokIcon,
    matches: ["grok", "xai", "x.ai"],
  },
  {
    label: "Azure OpenAI",
    color: "#0078D4",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    Icon: AzureOpenAIIcon,
    matches: ["azure", "azure-openai", "azureopenai"],
  },
];

/**
 * Given a provider/model string, returns the matched LLMProviderMeta or null.
 * Matching is case-insensitive substring.
 */
export function detectLLMProvider(
  provider?: string,
  model?: string,
): LLMProviderMeta | null {
  const haystack = [provider, model]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) return null;
  for (const p of LLM_PROVIDERS) {
    if (p.matches.some((m) => haystack.includes(m))) return p;
  }
  return null;
}
