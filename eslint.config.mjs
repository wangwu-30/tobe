import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/framework/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/agent/**",
                "@/canvas/**",
                "@/derive/**",
                "@/objects/**",
                "@/surfaces/**",
                "../agent/**",
                "../canvas/**",
                "../derive/**",
                "../objects/**",
                "../surfaces/**",
                "../../agent/**",
                "../../canvas/**",
                "../../derive/**",
                "../../objects/**",
                "../../surfaces/**",
              ],
              message: "framework/ 不能依赖 application 层",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    ignores: ["src/framework/resilience/safe-data.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message: "禁止裸 JSON.parse；请使用 framework/resilience/safe-data.ts 中的 safeJsonParse。",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    ignores: [
      "src/framework/resilience/api-client.ts",
      "src/agent/run.ts",
      "src/hooks/use-ai-reply.ts",
      "src/lib/search/providers/brave-search.ts",
      "src/lib/search/providers/volcengine-web-search.ts",
      "src/app/api/workspaces/[workspaceId]/preview/bridge/[runId]/[[...path]]/route.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='fetch']",
          message: "禁止裸 fetch；请通过 framework/resilience/api-client.ts 发起请求。",
        },
      ],
    },
  },
  {
    files: ["src/app/api/**/route.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ExportNamedDeclaration > FunctionDeclaration[id.name=/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/]",
          message: "API route handler 必须通过 defineRoute(...) 导出。",
        },
        {
          selector:
            "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name=/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/][init.type!='CallExpression']",
          message: "API route handler 必须通过 defineRoute(...) 导出。",
        },
        {
          selector:
            "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name=/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/][init.type='CallExpression'][init.callee.name!='defineRoute']",
          message: "API route handler 必须通过 defineRoute(...) 导出。",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".tmp/**",
    ".vite/**",
    "apps/**/.vite/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
