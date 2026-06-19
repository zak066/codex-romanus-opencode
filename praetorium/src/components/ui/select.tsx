'use client';

import React, { useState, useRef, useEffect, useCallback, useId } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

function Select({
  options,
  value,
  onChange,
  placeholder = 'Seleziona...',
  label,
  error,
  disabled = false,
  className = '',
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const labelId = label ? `${id}-label` : undefined;
  const listboxId = `${id}-listbox`;

  const selectedOption = options.find((opt) => opt.value === value);
  const errorId = error ? `${id}-error` : undefined;

  // Chiudi al click fuori
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else {
            // Seleziona l'elemento evidenziato
            const focused = listRef.current?.querySelector<HTMLLIElement>(
              '[aria-selected="true"]',
            );
            if (focused) {
              focused.click();
            }
          }
          break;
        case 'Escape':
          setIsOpen(false);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else {
            const items = listRef.current?.querySelectorAll<HTMLLIElement>('[role="option"]');
            if (!items || items.length === 0) return;
            const activeEl = document.activeElement;
            const currentIdx = Array.from(items).indexOf(activeEl as HTMLLIElement);
            const nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
            items[nextIdx].focus();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (isOpen) {
            const items = listRef.current?.querySelectorAll<HTMLLIElement>('[role="option"]');
            if (!items || items.length === 0) return;
            const activeEl = document.activeElement;
            const currentIdx = Array.from(items).indexOf(activeEl as HTMLLIElement);
            const prevIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
            items[prevIdx].focus();
          }
          break;
        case 'Home':
          e.preventDefault();
          if (isOpen && listRef.current) {
            const first = listRef.current.querySelector<HTMLLIElement>('[role="option"]');
            first?.focus();
          }
          break;
        case 'End':
          e.preventDefault();
          if (isOpen && listRef.current) {
            const opts = listRef.current.querySelectorAll<HTMLLIElement>('[role="option"]');
            opts[opts.length - 1]?.focus();
          }
          break;
      }
    },
    [disabled, isOpen],
  );

  const handleSelect = (opt: SelectOption) => {
    onChange?.(opt.value);
    setIsOpen(false);
  };

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label
          id={labelId}
          className="block text-sm font-medium text-text-secondary mb-1.5"
        >
          {label}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-labelledby={labelId}
          aria-controls={listboxId}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus ${
            error
              ? 'border-semantic-error focus:ring-semantic-error/50 focus:border-semantic-error'
              : 'border-border-default hover:border-border-focus/50'
          } ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          } bg-surface-overlay border text-text-primary`}
        >
          <span className={selectedOption ? 'text-text-primary' : 'text-text-muted'}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <svg
            className={`h-4 w-4 text-text-muted transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {isOpen && (
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            className="absolute z-40 mt-1 w-full bg-surface-raised border border-border-default rounded-lg shadow-lg max-h-60 overflow-auto py-1"
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={handleKeyDown}
          >
            {options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted text-center">
                Nessuna opzione
              </li>
            ) : (
              options.map((opt, idx) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  tabIndex={-1}
                  onClick={() => handleSelect(opt)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      handleSelect(opt);
                    }
                  }}
                  onFocus={() => {
                    // Scroll into view if needed
                    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
                  }}
                  className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                    opt.value === value
                      ? 'bg-roman-gold/10 text-roman-gold'
                      : 'text-text-primary hover:bg-surface-overlay'
                  } ${idx > 0 ? 'border-t border-border-subtle' : ''}`}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-semantic-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export { Select };
export type { SelectProps, SelectOption };
