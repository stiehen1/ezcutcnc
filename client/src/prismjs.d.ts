// Minimal ambient declarations for prismjs — the package ships no bundled types and
// @types/prismjs isn't installed. CodeEditor only uses Prism.highlight + the language
// side-effect imports, so a thin surface is enough.
declare module "prismjs" {
  const Prism: {
    highlight(text: string, grammar: unknown, language: string): string;
    languages: Record<string, unknown>;
    highlightAll(): void;
  };
  export default Prism;
}

declare module "prismjs/components/prism-python";
