import * as ts from 'typescript';

export interface NormalizeResult {
  code: string;
  fixes: string[];
  diagnostics: readonly ts.DiagnosticWithLocation[];
  timeMs: number;
}

export function normalizeTsx(source: string, fileName = 'input.tsx'): NormalizeResult {
  const start = Date.now();
  const fixes: string[] = [];

  // Pre-process to fix patterns that TypeScript can't parse
  // Fix JSX attributes with single brace object literals: prop={ key: value } -> prop={{ key: value }}
  let preprocessed = source.replace(
    /(\w+)\s*=\s*\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*\s*:\s*[^}]+(?:,\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*:\s*[^}]+)*)\s*\}/g,
    (match, attrName, objectContent) => {
      // Check if it's already double-braced or contains JSX expressions
      if (match.includes('{{') || match.includes('}}') || match.includes('<') || match.includes('>')) {
        return match;
      }
      fixes.push('object-prop-single-to-double-brace');
      return `${attrName}={{ ${objectContent} }}`;
    }
  );

  const sf = ts.createSourceFile(fileName, preprocessed, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const { factory } = context;
    const visit = (node: ts.Node): ts.Node => {
      try {
        // Add safety check for node existence
        if (!node) {
          return node;
        }

        if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name) && node.name.text === 'class') {
        fixes.push('class-attribute');
        return factory.updateJsxAttribute(node, factory.createIdentifier('className'), node.initializer);
      }

      if (ts.isJsxElement(node) && node.children && node.children.length === 0) {
        fixes.push('empty-tag');
        return factory.createJsxSelfClosingElement(
          node.openingElement.tagName,
          node.openingElement.typeArguments,
          node.openingElement.attributes
        );
      }

      if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
        const expr = node.initializer.expression;
        // The comma operator pattern is now handled by preprocessing, so we only need to handle object literals
        if (expr && ts.isObjectLiteralExpression(expr)) {
          const cleanedProps: ts.ObjectLiteralElementLike[] = [];
          expr.properties.forEach((p) => {
            if (ts.isPropertyAssignment(p)) {
              cleanedProps.push(factory.updatePropertyAssignment(p, p.name, p.initializer));
            } else {
              cleanedProps.push(p);
            }
          });
          if (cleanedProps.length === expr.properties.length) {
            const obj = factory.createObjectLiteralExpression(cleanedProps, true);
            fixes.push('object-literal');
            return factory.updateJsxAttribute(node, node.name, factory.createJsxExpression(undefined, obj));
          }
        }
      }

        return ts.visitEachChild(node, visit, context);
      } catch (error) {
        console.error(`[TSX-NORMALIZE] Error visiting node: ${error}`);
        // Return node unchanged if transformation fails
        return node;
      }
    };
    return (node) => ts.visitNode(node, visit);
  };

  const result = ts.transform(sf, [transformer]);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  let code = printer.printFile(result.transformed[0]);

  const cleaned = code
    .replace(/,\s*(\/>)?/g, (m, end) => (end ? end : ', '))
    .replace(/,\s*}/g, ' }');
  if (cleaned !== code) {
    fixes.push('trailing-punctuation');
    code = cleaned;
  }

  if (!/export\s+default/.test(code)) {
    const match = code.match(/export\s+function\s+([A-Za-z0-9_]+)/);
    if (match) {
      code = code.replace('export function', 'export default function');
      fixes.push('default-export');
    }
  }

  const check = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const timeMs = Date.now() - start;
  return { code, fixes, diagnostics: check.parseDiagnostics as ts.DiagnosticWithLocation[], timeMs };
}
