import { defineConfig } from 'orval';

export default defineConfig({
  litellm: {
    input: './lambda/utils/liteLlm/openai_openapi.yml',
    output: {
      mode: 'tags-split',
      target: './lambda/utils/liteLlm',
      schemas: './lambda/utils/liteLlm/schemas',
      client: 'fetch',
    },
    hooks: {
      afterAllFilesWrite: 'prettier --write',
    },
  },
});
