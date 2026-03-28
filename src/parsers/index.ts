import type { ProjectParser } from "./project-parser";
import { defaultParser } from "./default-parser";
import { ticketIdProjectParser } from "./ticket-id-project-parser";

export const parsers: ProjectParser[] = [ticketIdProjectParser, defaultParser];

export function getParserByName(parserName: string): ProjectParser {
  return parsers.find((parser) => parser.name === parserName) ?? defaultParser;
}
