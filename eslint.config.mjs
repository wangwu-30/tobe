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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
