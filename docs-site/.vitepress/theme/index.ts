// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: Apache-2.0

import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { defineAsyncComponent } from "vue";
import MettaRunner from "./MettaRunner.vue";
import MeTTaGrapher from "./MeTTaGrapher.vue";
import "./custom.css";

const BrowserIDE = defineAsyncComponent(() => import("./BrowserIDE.vue"));

// Register the interactive browser surfaces for use from documentation pages.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("BrowserIDE", BrowserIDE);
    app.component("MettaRunner", MettaRunner);
    app.component("MeTTaGrapher", MeTTaGrapher);
  },
} satisfies Theme;
