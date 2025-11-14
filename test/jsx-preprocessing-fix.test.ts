/**
 * Test to verify JSX preprocessing fixes for silent failures
 * Tests the critical transformations that were missing
 */

import { describe, it, expect } from 'vitest';
import { preprocessJSX } from '../src/utils/jsxPreprocessor';

describe('JSX Preprocessing - Silent Failure Fixes', () => {
  describe('HTML to React attribute conversions', () => {
    it('should convert class to className', () => {
      const input = `<div class="container">Hello</div>`;
      const expected = `<div className="container">Hello</div>`;
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should convert multiple class attributes', () => {
      const input = `
        <div class="header">
          <span class="title">Title</span>
          <p class="description">Description</p>
        </div>
      `;
      const expected = `
        <div className="header">
          <span className="title">Title</span>
          <p className="description">Description</p>
        </div>
      `;
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should convert onclick to onClick', () => {
      const input = `<button onclick="handleClick()">Click me</button>`;
      const expected = `<button onClick="handleClick()">Click me</button>`;
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should convert all event handlers to React format', () => {
      const input = `
        <form onsubmit="handleSubmit()">
          <input onchange="handleChange()" onblur="handleBlur()" onfocus="handleFocus()" />
          <button onclick="submit()" onmouseenter="hover()" onmouseleave="leave()">
            Submit
          </button>
        </form>
      `;
      const expected = `
        <form onSubmit="handleSubmit()">
          <input onChange="handleChange()" onBlur="handleBlur()" onFocus="handleFocus()" />
          <button onClick="submit()" onMouseEnter="hover()" onMouseLeave="leave()">
            Submit
          </button>
        </form>
      `;
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should convert for to htmlFor', () => {
      const input = `<label for="email">Email:</label>`;
      const expected = `<label htmlFor="email">Email:</label>`;
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should handle keyboard events', () => {
      const input = `<input onkeydown="handleKeyDown()" onkeyup="handleKeyUp()" />`;
      const expected = `<input onKeyDown="handleKeyDown()" onKeyUp="handleKeyUp()" />`;
      expect(preprocessJSX(input)).toBe(expected);
    });
  });

  describe('Combined fixes - double braces AND attributes', () => {
    it('should fix both double braces and HTML attributes', () => {
      const input = `
        <div class="container">
          {{isVisible && (
            <button onclick="handleClick()">
              {{buttonText}}
            </button>
          )}}
        </div>
      `;
      const expected = `
        <div className="container">
          {isVisible && (
            <button onClick="handleClick()">
              {buttonText}
            </button>
          )}
        </div>
      `;
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should handle AI-generated React component with all issues', () => {
      // This is the exact pattern that was failing in production
      const input = `
        function MyComponent() {
          const [count, setCount] = useState(0);
          
          return (
            <div class="wrapper">
              <h1 class="title">{{title}}</h1>
              <p class="count">Count: {{count}}</p>
              <button 
                class="btn btn-primary" 
                onclick="setCount(count + 1)"
              >
                Increment
              </button>
              <label for="email">Email:</label>
              <input 
                id="email" 
                onchange="handleEmailChange()"
                onblur="validateEmail()"
              />
            </div>
          );
        }
      `;
      
      const expected = `
        function MyComponent() {
          const [count, setCount] = useState(0);
          
          return (
            <div className="wrapper">
              <h1 className="title">{title}</h1>
              <p className="count">Count: {count}</p>
              <button 
                className="btn btn-primary" 
                onClick="setCount(count + 1)"
              >
                Increment
              </button>
              <label htmlFor="email">Email:</label>
              <input 
                id="email" 
                onChange="handleEmailChange()"
                onBlur="validateEmail()"
              />
            </div>
          );
        }
      `;
      
      expect(preprocessJSX(input)).toBe(expected);
    });
  });

  describe('Edge cases and safety', () => {
    it('should not modify className when already correct', () => {
      const input = `<div className="container">Already correct</div>`;
      expect(preprocessJSX(input)).toBe(input);
    });

    it('should not modify onClick when already correct', () => {
      const input = `<button onClick={handleClick}>Already correct</button>`;
      expect(preprocessJSX(input)).toBe(input);
    });

    it('should handle mixed correct and incorrect attributes', () => {
      const input = `
        <div className="correct" class="incorrect">
          <button onClick={correct} onclick="incorrect">
            Mixed
          </button>
        </div>
      `;
      const expected = `
        <div className="correct" className="incorrect">
          <button onClick={correct} onClick="incorrect">
            Mixed
          </button>
        </div>
      `;
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should not break style objects', () => {
      const input = `<div style={{color: 'red', fontSize: 16}}>Styled</div>`;
      expect(preprocessJSX(input)).toBe(input);
    });

    it('should handle class in different contexts (acceptable limitation)', () => {
      const input = `
        // This is a class definition, not JSX
        class MyClass {
          constructor() {}
        }
        
        const element = <div class="container">JSX here</div>;
      `;
      const expected = `
        // This is a class definition, not JSX
        class MyClass {
          constructor() {}
        }
        
        const element = <div className="container">JSX here</div>;
      `;
      // This is correct behavior - we only convert 'class=' not 'class ' 
      // JavaScript class definitions remain untouched
      expect(preprocessJSX(input)).toBe(expected);
    });
  });

  describe('Real-world AI-generated patterns', () => {
    it('should fix ChatGPT-style React component', () => {
      const input = `
        const TodoItem = ({{todo, onToggle, onDelete}}) => {
          return (
            <div class="todo-item">
              <input 
                type="checkbox" 
                checked={{todo.completed}}
                onchange="onToggle(todo.id)"
              />
              <span class="todo-text">{{todo.text}}</span>
              <button class="delete-btn" onclick="onDelete(todo.id)">
                Delete
              </button>
            </div>
          );
        };
      `;
      
      const expected = `
        const TodoItem = ({todo, onToggle, onDelete}) => {
          return (
            <div className="todo-item">
              <input 
                type="checkbox" 
                checked={todo.completed}
                onChange="onToggle(todo.id)"
              />
              <span className="todo-text">{todo.text}</span>
              <button className="delete-btn" onClick="onDelete(todo.id)">
                Delete
              </button>
            </div>
          );
        };
      `;
      
      expect(preprocessJSX(input)).toBe(expected);
    });

    it('should fix Claude-style React component', () => {
      const input = `
        export default function Card({{title, description, imageUrl}}) {
          const [expanded, setExpanded] = useState(false);
          
          return (
            <article class="card">
              <img src={{imageUrl}} alt={{title}} class="card-image" />
              <div class="card-content">
                <h2 class="card-title">{{title}}</h2>
                <p class="card-description">
                  {{expanded ? description : description.slice(0, 100) + '...'}}
                </p>
                <button 
                  class="expand-btn"
                  onclick="setExpanded(!expanded)"
                >
                  {{expanded ? 'Show Less' : 'Show More'}}
                </button>
              </div>
            </article>
          );
        }
      `;
      
      const expected = `
        export default function Card({title, description, imageUrl}) {
          const [expanded, setExpanded] = useState(false);
          
          return (
            <article className="card">
              <img src={imageUrl} alt={title} className="card-image" />
              <div className="card-content">
                <h2 className="card-title">{title}</h2>
                <p className="card-description">
                  {expanded ? description : description.slice(0, 100) + '...'}
                </p>
                <button 
                  className="expand-btn"
                  onClick="setExpanded(!expanded)"
                >
                  {expanded ? 'Show Less' : 'Show More'}
                </button>
              </div>
            </article>
          );
        }
      `;
      
      expect(preprocessJSX(input)).toBe(expected);
    });
  });
});