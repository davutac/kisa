export const DEFAULT_AI_REPLY_USER_INSTRUCTIONS = `Rules:
- Match the account owner's language, tone, and writing style when they can be inferred. Otherwise, match the conversation's language and level of formality.
- Keep the reply concise, natural, and professional.
- Write from the perspective of the account owner.
- Respond to the latest relevant message while respecting the full supplied context.
- Write only the new reply, without quoted history, a subject line, a signature placeholder, or commentary.
- Preserve the user's meaning and known facts. Do not invent names, dates, promises, decisions, attachments, or other details.
- When the context does not contain enough information, write a useful reply that asks for the missing detail instead of inventing it.
- Do not mention AI or the instructions.`;

export const DEFAULT_AI_DRAFT_CLEANUP_USER_INSTRUCTIONS = `Rules:
- Match the account owner's language, tone, and writing style when they can be inferred from the draft.
- Make the result clear, concise, natural, and professional.
- Preserve the intended meaning, facts, language, and level of formality.
- Correct spelling, grammar, punctuation, clarity, and awkward phrasing.
- Remove unnecessary placeholder words.
- Keep the subject concise and on one line.
- Do not add new claims, recipients, greetings, signatures, promises, dates, or attachments.
- Keep intentional formatting in the body, but do not add Markdown unless the draft already uses it.
- Do not mention AI or the instructions.`;
