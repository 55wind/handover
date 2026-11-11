import type { NextConfig } from 'next';

const config: NextConfig = {
  // The toolkit pulls in large CommonJS dependencies; load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ['@paypal/agent-toolkit', 'openai'],
};

export default config;
