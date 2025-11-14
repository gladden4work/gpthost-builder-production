/**
 * Test suite for JSX Preprocessor
 * Tests fixing AI-generated JSX patterns that cause build failures
 */

import { describe, it, expect } from 'vitest';
import { preprocessJSX, shouldPreprocessFile, isReactContent } from '../src/utils/jsxPreprocessor';

describe('JSX Preprocessor', () => {
  describe('preprocessJSX', () => {
    it('should preserve dangerouslySetInnerHTML double braces', () => {
      const input = `
        function View({ html }) {
          return (
            <div>
              <span dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          );
        }
      `;
      const output = preprocessJSX(input);
      expect(output).toContain('dangerouslySetInnerHTML={{ __html: html }}');
      // Ensure we did not collapse to a single brace
      expect(output).not.toContain('dangerouslySetInnerHTML={ __html: html }');
    });
    it('should fix double curly braces in text content', () => {
      const input = `
        <div>
          <p>{{user.name && \`Welcome, \${user.name}!\`}}</p>
          <span>{{count > 0 && \`Count is \${count}\`}}</span>
        </div>
      `;
      const output = preprocessJSX(input);
      expect(output).toContain('<p>{user.name && `Welcome, ${user.name}!`}</p>');
      expect(output).toContain('<span>{count > 0 && `Count is ${count}`}</span>');
      expect(output).not.toContain('{{');
    });

    it('should preserve style objects with double curly braces', () => {
      const input = `
        <div style={{ padding: '20px', backgroundColor: '#f0f0f0' }}>
          <button style={{ color: 'blue', fontSize: '16px' }}>Click Me</button>
        </div>
      `;
      const output = preprocessJSX(input);
      // Style objects should remain unchanged
      expect(output).toContain('style={{ padding: \'20px\', backgroundColor: \'#f0f0f0\' }}');
      expect(output).toContain('style={{ color: \'blue\', fontSize: \'16px\' }}');
    });

    it('should fix style attribute string literals', () => {
      const input = `
        <div style="{{padding: '20px'}}">
          <span style='{{color: "red"}}'>Text</span>
        </div>
      `;
      const output = preprocessJSX(input);
      expect(output).toContain('<div style={{padding: \'20px\'}}>');
      expect(output).toContain('<span style={{color: "red"}}>');
    });

    it('should fix className string literals with braces', () => {
      const input = `
        <div className="{styles.container}">
          <span className='{active ? "active" : "inactive"}'>Text</span>
        </div>
      `;
      const output = preprocessJSX(input);
      expect(output).toContain('className={styles.container}');
      expect(output).toContain('className={active ? "active" : "inactive"}');
    });

    it('should fix event handler string literals', () => {
      const input = `
        <button onClick="{() => handleClick()}">Click</button>
        <input onChange="{(e) => setValue(e.target.value)}" />
        <div onMouseEnter="{handleHover}" />
      `;
      const output = preprocessJSX(input);
      expect(output).toContain('onClick={() => handleClick()}');
      expect(output).toContain('onChange={(e) => setValue(e.target.value)}');
      expect(output).toContain('onMouseEnter={handleHover}');
    });

    it('should handle complex mixed patterns', () => {
      const input = `
        function Component() {
          return (
            <div style={{ padding: '20px' }}>
              <h1>{{title || 'Default Title'}}</h1>
              <button 
                onClick="{handleSubmit}"
                className="{isActive ? 'btn-active' : 'btn'}"
                style={{ backgroundColor: isActive ? 'green' : 'gray' }}
              >
                {{buttonText}}
              </button>
            </div>
          );
        }
      `;
      const output = preprocessJSX(input);
      
      // Double braces in content should be fixed
      expect(output).toContain('<h1>{title || \'Default Title\'}</h1>');
      expect(output).toContain('{buttonText}');
      
      // Style objects should be preserved
      expect(output).toContain('style={{ padding: \'20px\' }}');
      expect(output).toContain('style={{ backgroundColor: isActive ? \'green\' : \'gray\' }}');
      
      // Event handlers and className should be fixed
      expect(output).toContain('onClick={handleSubmit}');
      expect(output).toContain('className={isActive ? \'btn-active\' : \'btn\'}');
    });

    it('should handle AI-generated React component patterns', () => {
      const input = `
        import React, { useState } from 'react';
        
        function TodoList() {
          const [todos, setTodos] = useState([]);
          const [input, setInput] = useState('');
          
          return (
            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
              <h1>{{todos.length > 0 ? \`You have \${todos.length} todos\` : 'No todos yet'}}</h1>
              <input 
                value="{{input}}"
                onChange="{(e) => setInput(e.target.value)}"
                style={{ padding: '10px', width: '100%' }}
              />
              <button onClick="{() => addTodo()}">Add Todo</button>
              {todos.map(todo => (
                <div key={{todo.id}} className="{todo.completed ? 'completed' : 'pending'}">
                  {{todo.text}}
                </div>
              ))}
            </div>
          );
        }
      `;
      const output = preprocessJSX(input);
      
      // Check all fixes
      expect(output).toContain('{todos.length > 0 ? `You have ${todos.length} todos` : \'No todos yet\'}');
      expect(output).not.toContain('value="{{input}}"');
      expect(output).toContain('onChange={(e) => setInput(e.target.value)}');
      expect(output).toContain('onClick={() => addTodo()}');
      expect(output).toContain('key={todo.id}');
      expect(output).toContain('className={todo.completed ? \'completed\' : \'pending\'}');
      expect(output).toContain('{todo.text}');
      
      // Style objects preserved
      expect(output).toContain('style={{ maxWidth: \'600px\', margin: \'0 auto\' }}');
      expect(output).toContain('style={{ padding: \'10px\', width: \'100%\' }}');
    });
  });

  describe('shouldPreprocessFile', () => {
    it('should return true for JSX/TSX files', () => {
      expect(shouldPreprocessFile('component.jsx')).toBe(true);
      expect(shouldPreprocessFile('App.tsx')).toBe(true);
      expect(shouldPreprocessFile('index.js')).toBe(true);
      expect(shouldPreprocessFile('types.ts')).toBe(true);
    });

    it('should return false for non-JS files', () => {
      expect(shouldPreprocessFile('styles.css')).toBe(false);
      expect(shouldPreprocessFile('index.html')).toBe(false);
      expect(shouldPreprocessFile('data.json')).toBe(false);
      expect(shouldPreprocessFile('README.md')).toBe(false);
    });
  });

  describe('isReactContent', () => {
    it('should detect React imports', () => {
      expect(isReactContent('import React from "react"')).toBe(true);
      expect(isReactContent('import { useState } from "react"')).toBe(true);
      expect(isReactContent('import { Component } from "react"')).toBe(true);
    });

    it('should detect JSX component tags', () => {
      expect(isReactContent('<Button />')).toBe(true);
      expect(isReactContent('<MyComponent>')).toBe(true);
      expect(isReactContent('<App />')).toBe(true);
    });

    it('should detect JSX fragments', () => {
      expect(isReactContent('<>content</>')).toBe(true);
      expect(isReactContent('<React.Fragment>')).toBe(false); // This would need component tag detection
    });

    it('should return false for non-React content', () => {
      expect(isReactContent('const data = { key: "value" }')).toBe(false);
      expect(isReactContent('function calculate() { return 42; }')).toBe(false);
    });
  });

  describe('Complex multiline patterns from strategy document', () => {
    it('should handle the exact multiline JSX pattern from strategy', () => {
      // This is THE test case from JSX-PREPROCESSING-STRATEGY.md line 33-54
      const input = `
{{filteredTodos.length === 0 && (
  <p style={{ textAlign: 'center' }}>
    {{message}}
  </p>
)}}`;
      
      const expected = `
{filteredTodos.length === 0 && (
  <p style={{ textAlign: 'center' }}>
    {message}
  </p>
)}`;
      
      const output = preprocessJSX(input);
      expect(output).toBe(expected);
    });

    it('should handle deeply nested multiline JSX with multiple levels', () => {
      const input = `
{{condition1 && (
  <div>
    {{condition2 ? (
      <span>{{value}}</span>
    ) : (
      <p>{{otherValue}}</p>
    )}}
  </div>
)}}`;
      
      const expected = `
{condition1 && (
  <div>
    {condition2 ? (
      <span>{value}</span>
    ) : (
      <p>{otherValue}</p>
    )}
  </div>
)}`;
      
      const output = preprocessJSX(input);
      expect(output).toBe(expected);
    });

    it('should handle complex component with mixed patterns', () => {
      const input = `
function TodoApp() {
  return (
    <div style={{ padding: '20px' }}>
      {{todos.length === 0 ? (
        <p style={{ color: 'gray' }}>{{emptyMessage}}</p>
      ) : (
        <ul>
          {{todos.map(todo => (
            <li key={{todo.id}} style={{ textDecoration: todo.done ? 'line-through' : 'none' }}>
              {{todo.text}}
            </li>
          ))}}
        </ul>
      )}}
    </div>
  );
}`;
      
      const expected = `
function TodoApp() {
  return (
    <div style={{ padding: '20px' }}>
      {todos.length === 0 ? (
        <p style={{ color: 'gray' }}>{emptyMessage}</p>
      ) : (
        <ul>
          {todos.map(todo => (
            <li key={todo.id} style={{ textDecoration: todo.done ? 'line-through' : 'none' }}>
              {todo.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export default TodoApp;`;
      
      const output = preprocessJSX(input);
      expect(output).toBe(expected);
    });
  });

  describe('Real-world AI patterns', () => {
    it('should fix ChatGPT-generated component', () => {
      const input = `
        export default function Card() {
          const [expanded, setExpanded] = useState(false);
          
          return (
            <div className="{styles.card}" style={{ border: '1px solid #ccc' }}>
              <h2>{{title}}</h2>
              <p>{{description && \`Description: \${description}\`}}</p>
              <button onClick="{() => setExpanded(!expanded)}">
                {{expanded ? 'Show Less' : 'Show More'}}
              </button>
            </div>
          );
        }
      `;
      const output = preprocessJSX(input);
      
      expect(output).toContain('className={styles.card}');
      expect(output).toContain('<h2>{title}</h2>');
      expect(output).toContain('{description && `Description: ${description}`}');
      expect(output).toContain('onClick={() => setExpanded(!expanded)}');
      expect(output).toContain('{expanded ? \'Show Less\' : \'Show More\'}');
      expect(output).toContain('style={{ border: \'1px solid #ccc\' }}');
    });

    it('should fix Claude-generated component with complex patterns', () => {
      const input = `
        function DataTable({ data, columns }) {
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={{col.id}} style="{{padding: '10px'}}">
                      {{col.header}}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => (
                  <tr key={{idx}} className="{idx % 2 === 0 ? 'even' : 'odd'}">
                    {columns.map(col => (
                      <td key={{\`\${idx}-\${col.id}\`}}>
                        {{row[col.field]}}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
      `;
      const output = preprocessJSX(input);
      
      expect(output).toContain('key={col.id}');
      expect(output).toContain('style={{padding: \'10px\'}}');
      expect(output).toContain('{col.header}');
      expect(output).toContain('key={idx}');
      expect(output).toContain('className={idx % 2 === 0 ? \'even\' : \'odd\'}');
      expect(output).toContain('key={`${idx}-${col.id}`}');
      expect(output).toContain('{row[col.field]}');
      expect(output).toContain('style={{ width: \'100%\', borderCollapse: \'collapse\' }}');
    });
  });

  describe('Missing export statement fixes', () => {
    it('should add export statement to function component without export', () => {
      const input = `
function ComplexComponent() {
  const data = { value: 42 };
  return (
    <div style={{ color: 'blue', fontSize: '16px' }}>
      {data.value && data.value > 40 ? 'High' : 'Low'}
      <span className={data.value > 50 ? 'highlight' : ''}>
        Value: {data.value}
      </span>
    </div>
  );
}`;
      
      const output = preprocessJSX(input, 'component.jsx');
      expect(output).toContain('export default ComplexComponent;');
    });

    it('should add export statement to arrow function component', () => {
      const input = `
const MyComponent = () => {
  return <div>Hello World</div>;
};`;
      
      const output = preprocessJSX(input, 'MyComponent.jsx');
      expect(output).toContain('export default MyComponent;');
    });

    it('should add export statement to class component', () => {
      const input = `
class TodoList extends React.Component {
  render() {
    return <ul>{this.props.items.map(item => <li key={item.id}>{item.text}</li>)}</ul>;
  }
}`;
      
      const output = preprocessJSX(input, 'TodoList.jsx');
      expect(output).toContain('export default TodoList;');
    });

    it('should not add duplicate export if one already exists', () => {
      const input = `
function MyComponent() {
  return <div>Already exported</div>;
}

export default MyComponent;`;
      
      const output = preprocessJSX(input, 'MyComponent.jsx');
      // Should only have one export statement
      const exportMatches = output.match(/export default MyComponent;/g);
      expect(exportMatches?.length).toBe(1);
    });

    it('should handle component with named export', () => {
      const input = `
export function MyComponent() {
  return <div>Named export</div>;
}`;
      
      const output = preprocessJSX(input, 'MyComponent.jsx');
      // Should not add default export when named export exists
      expect(output).not.toContain('export default MyComponent;');
    });

    it('should fix the exact pattern from failed GitHub Actions runs', () => {
      // This is the EXACT component that caused builds #734, #735, #736 to fail
      const input = `
function ComplexComponent() {
  const data = { value: 42 };
  return (
    <div style={{ color: 'blue', fontSize: '16px' }}>
      {data.value && data.value > 40 ? 'High' : 'Low'}
      <span className={data.value > 50 ? 'highlight' : ''}>
        Value: {data.value}
      </span>
    </div>
  );
}`;
      
      const output = preprocessJSX(input, 'src/components/component.jsx');
      
      // Must have export statement to prevent build failure
      expect(output).toContain('export default ComplexComponent;');
      
      // Verify the rest of the component is unchanged
      expect(output).toContain('function ComplexComponent()');
      expect(output).toContain('const data = { value: 42 };');
      expect(output).toContain('style={{ color: \'blue\', fontSize: \'16px\' }}');
    });
  });
});
