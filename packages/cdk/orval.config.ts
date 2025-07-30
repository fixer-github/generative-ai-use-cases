import { defineConfig } from 'orval';

export default defineConfig({
  litellm: {
    input: 'https://litellm-api.up.railway.app/openapi.json',
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
