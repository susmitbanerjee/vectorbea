/**
 * ProviderIcon — monochrome SVG icons for LLM providers.
 * All icons render with currentColor so they inherit text color.
 * No external network requests.
 */

interface IconProps {
  className?: string;
}

export function OpenAIIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M22.28 9.77a5.7 5.7 0 0 0-.49-4.68 5.76 5.76 0 0 0-6.2-2.76A5.72 5.72 0 0 0 11.29 1a5.76 5.76 0 0 0-5.49 3.99 5.72 5.72 0 0 0-3.82 2.77 5.77 5.77 0 0 0 .71 6.76 5.72 5.72 0 0 0 .49 4.68 5.76 5.76 0 0 0 6.2 2.76A5.72 5.72 0 0 0 12.71 23a5.77 5.77 0 0 0 5.5-3.99 5.72 5.72 0 0 0 3.81-2.77 5.77 5.77 0 0 0-.74-6.47zM12.72 21.5a4.27 4.27 0 0 1-2.74-1c.03-.02.09-.05.13-.07l4.55-2.63a.74.74 0 0 0 .38-.65v-6.42l1.92 1.11a.07.07 0 0 1 .04.06v5.31a4.3 4.3 0 0 1-4.28 4.29zM3.48 17.57a4.27 4.27 0 0 1-.51-2.88l.13.08 4.55 2.63a.75.75 0 0 0 .75 0l5.56-3.21v2.22a.07.07 0 0 1-.03.07l-4.6 2.66a4.3 4.3 0 0 1-5.85-1.57zm-1.12-9.9A4.27 4.27 0 0 1 4.6 5.56v5.42a.75.75 0 0 0 .38.65l5.55 3.2-1.92 1.11a.07.07 0 0 1-.07 0L4 13.28a4.3 4.3 0 0 1-1.64-5.61zm15.76 3.69-5.55-3.21 1.92-1.1a.07.07 0 0 1 .07 0l4.54 2.63a4.29 4.29 0 0 1-.66 7.74v-5.42a.75.75 0 0 0-.32-.64zm1.91-2.9-.13-.08-4.54-2.63a.75.75 0 0 0-.76 0L9.05 9.16V6.94a.07.07 0 0 1 .03-.07l4.6-2.65a4.3 4.3 0 0 1 6.35 4.44zm-12.04 3.96-1.92-1.11a.07.07 0 0 1-.04-.07V5.93a4.29 4.29 0 0 1 7.04-3.3l-.13.07-4.55 2.63a.74.74 0 0 0-.38.65l-.02 6.44zm1.04-2.25 2.47-1.43 2.47 1.42v2.84l-2.47 1.43-2.47-1.43V10.17z" />
    </svg>
  );
}

export function AnthropicIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-3.654 0H6.57L0 20h3.603l1.385-3.577h6.874L13.25 20h3.602l-6.679-16.48zm-1.7 9.673 2.25-5.817 2.25 5.817H8.473z" />
    </svg>
  );
}

export function GoogleIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  );
}

export function QwenIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      {/* Stylised Q letter mark for Qwen/Alibaba */}
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-5.5-1.41-1.41A3.97 3.97 0 0 1 12 16a4 4 0 1 1 2.09-7.41l1.41-1.41A5.97 5.97 0 0 0 12 6a6 6 0 1 0 4.91 9.5l1.09 1.09-1.5 1.5V18h1.5v-3h-3l1.5 1.5-1 1z" />
    </svg>
  );
}

export function EnterpriseGatewayIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M7 8h10M7 12h6" />
    </svg>
  );
}

/** Generic icon for unknown/custom providers */
export function GenericProviderIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4l3 3" />
    </svg>
  );
}

/**
 * Resolve icon component from a provider_type string.
 * Handles common spellings / aliases.
 */
export function ProviderIcon({
  providerType,
  className,
}: {
  providerType: string;
  className?: string;
}) {
  const t = providerType.toLowerCase();
  if (t.includes("openai") || t === "open_ai") return <OpenAIIcon className={className} />;
  if (t.includes("anthropic") || t.includes("claude")) return <AnthropicIcon className={className} />;
  if (t.includes("google") || t.includes("gemini") || t.includes("vertex")) return <GoogleIcon className={className} />;
  if (t.includes("qwen") || t.includes("alibaba") || t.includes("dashscope")) return <QwenIcon className={className} />;
  if (t.includes("gateway") || t.includes("enterprise") || t.includes("proxy")) return <EnterpriseGatewayIcon className={className} />;
  return <GenericProviderIcon className={className} />;
}
