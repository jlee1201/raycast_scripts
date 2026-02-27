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
  /** Preferences accessible in the `bulk-close-tabs` command */
  export type BulkCloseTabs = ExtensionPreferences & {}
  /** Preferences accessible in the `close-duplicate-tabs` command */
  export type CloseDuplicateTabs = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `bulk-close-tabs` command */
  export type BulkCloseTabs = {}
  /** Arguments passed to the `close-duplicate-tabs` command */
  export type CloseDuplicateTabs = {}
}

