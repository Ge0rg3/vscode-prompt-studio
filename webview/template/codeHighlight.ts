// Parses a note as markdown and colors the code inside its fenced blocks
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, LanguageDescription, LanguageSupport, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';

// Token classes, colored in template.css so light and dark themes adapt
const codeStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword, tags.operatorKeyword], class: 'cmt-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'cmt-string' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: 'cmt-number' },
  { tag: [tags.lineComment, tags.blockComment, tags.docComment], class: 'cmt-comment' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'cmt-function' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: 'cmt-type' },
  { tag: [tags.propertyName, tags.attributeName, tags.variableName], class: 'cmt-name' }
]);

// Languages parsed inside fenced code blocks, matched on the word after the opening backticks
const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'ts', 'tsx', 'typescript'], support: javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'json', support: json() }),
  LanguageDescription.of({ name: 'html', alias: ['xml'], support: html() }),
  LanguageDescription.of({ name: 'css', support: css() }),
  LanguageDescription.of({ name: 'yaml', alias: ['yml'], support: yaml() }),
  LanguageDescription.of({
    name: 'shell',
    alias: ['bash', 'sh', 'zsh'],
    support: new LanguageSupport(StreamLanguage.define(shell))
  })
];

// Color the code inside fenced blocks, the markdown around it keeps its own styling
const codeHighlighting: Extension = syntaxHighlighting(codeStyle);

// --- exports ---

// Parse the note as GitHub-flavored markdown, with the code in its fenced blocks parsed and colored too
export const markdownWithCode: Extension = [markdown({ base: markdownLanguage, extensions: GFM, codeLanguages }), codeHighlighting];
