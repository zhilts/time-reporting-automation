import { defaultParser } from "./default.ts";
import { ticketIdProjectParser } from "./ticket-id-project.ts";
import type { ProjectParser } from "../types.ts";

const parserList: ProjectParser[] = [ticketIdProjectParser, defaultParser];
const parserMap = new Map<string, ProjectParser>(parserList.map((parser) => [parser.name, parser]));

export function getParserByName(parserName: string): ProjectParser {
  return parserMap.get(parserName) ?? defaultParser;
}
