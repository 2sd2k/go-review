declare module '@sabaki/sgf' {
  interface SgfNode {
    id: number;
    data: Record<string, string[]>;
    children: SgfNode[];
  }

  export function parse(content: string): SgfNode[];
}
