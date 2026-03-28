import type { ParseContext, ParsedMeaning, TogglEntry } from "../types";

export interface ProjectParser {
  name: string;
  parseEntry(entry: TogglEntry, context: ParseContext): ParsedMeaning;
}
