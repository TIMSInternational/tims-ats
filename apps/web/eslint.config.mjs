import { fixupConfigRules } from "@eslint/compat";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  // eslint-config-next 16 exports native flat configs; FlatCompat accepts legacy configs only.
  ...fixupConfigRules(nextCoreWebVitals),
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
