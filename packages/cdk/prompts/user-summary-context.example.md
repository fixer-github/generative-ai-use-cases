# User Summary External Context

This file provides the complete system prompt for generating user profile summaries.
Copy this file to `user-summary-context.md` and customize it for your needs.

When this file exists, its content replaces the default system prompt entirely.

## Default Behavior (without this file)

The default prompt instructs the AI to:
- Aggregate daily summaries under 500 characters
- Identify patterns and recurring themes
- Highlight decisions and accomplishments
- Provide a holistic view of user activities
- Output in the same language as daily summaries

## Customization

Replace this content with your complete system prompt. Example structure:

```
# Role
You are a profile creator...

# Requirements
- Output length constraints
- Formatting rules
- Content focus areas

# Profile Perspectives
- Primary interest areas
- Recurring themes
- Progress and achievements
- Behavior patterns
- Ongoing tasks
```

The daily summaries will be provided separately in the user prompt.
