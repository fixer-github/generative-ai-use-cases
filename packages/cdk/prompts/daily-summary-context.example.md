# Daily Summary External Context

This file provides the complete system prompt for generating daily summaries.
Copy this file to `daily-summary-context.md` and customize it for your needs.

When this file exists, its content replaces the default system prompt entirely.

## Default Behavior (without this file)

The default prompt instructs the AI to:
- Summarize conversations under 200 characters
- Focus on key topics, decisions, and insights
- Use clear, direct language
- Output in the same language as conversations

## Customization

Replace this content with your complete system prompt. Example structure:

```
# Role
You are a summarizer...

# Requirements
- Output length constraints
- Formatting rules
- Content focus areas

# Summary Perspectives
- Topics discussed
- User concerns
- Actions taken
- Outcomes achieved
- Next steps identified
```

The conversation log will be provided separately in the user prompt.
