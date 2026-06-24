/**
 * ElevenLabs config gate.
 *
 * A single place to ask "is the ElevenLabs integration usable right now?"
 * Callers gate any ElevenLabs feature behind this check instead of reading
 * env vars in scattered places.
 *
 * The three required vars are:
 *   ELEVENLABS_API_KEY      — server-side API key for ElevenLabs REST calls
 *   ELEVENLABS_AGENT_ID     — default Conversational AI agent
 *   ELEVENLABS_WEBHOOK_SECRET — HMAC secret for post-call webhook verification
 */

/** Returns true iff all three ElevenLabs env vars are present and non-empty. */
export function isElevenLabsConfigured(): boolean {
  return (
    Boolean(process.env.ELEVENLABS_API_KEY) &&
    Boolean(process.env.ELEVENLABS_AGENT_ID) &&
    Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET)
  );
}
