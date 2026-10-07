/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `switch-tab` command */
  export type SwitchTab = ExtensionPreferences & {}
  /** Preferences accessible in the `switch-tab-edge` command */
  export type SwitchTabEdge = ExtensionPreferences & {}
  /** Preferences accessible in the `switch-tab-chrome` command */
  export type SwitchTabChrome = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `switch-tab` command */
  export type SwitchTab = {}
  /** Arguments passed to the `switch-tab-edge` command */
  export type SwitchTabEdge = {}
  /** Arguments passed to the `switch-tab-chrome` command */
  export type SwitchTabChrome = {}
}

