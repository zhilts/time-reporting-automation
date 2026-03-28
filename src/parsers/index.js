import { defaultParser } from "./default.js";
import { ticketIdProjectParser } from "./ticket-id-project.js";

const parserList = [ticketIdProjectParser, defaultParser];
const parserMap = new Map(parserList.map((parser) => [parser.name, parser]));

export function getParserByName(parserName) {
  return parserMap.get(parserName) ?? defaultParser;
}
