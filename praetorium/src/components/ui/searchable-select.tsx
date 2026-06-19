'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';

interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Seleziona...',
  searchPlaceholder = 'Cerca...',
  className = '',
  disabled = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const listboxId = `${id}-listbox`;
  const searchInputId = `${id}-search`;

  const selectedOption = options.find((opt) => opt.value === value);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase().trim();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        opt.value.toLowerCase().includes(query),
    );
  }, [options, searchQuery]);

  // Reset search when closing
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Focus search input when opening
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Close on click outside
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

  const handleSelect = useCallback(
    (opt: SearchableSelectOption) => {
      onChange?.(opt.value);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter': {
          e.preventDefault();
          if (isOpen) {
            // Select the highlighted option from the list
            const focused = listRef.current?.querySelector<HTMLLIElement>(
              '[aria-selected="true"]',
            );
            if (focused) {
              focused.click();
            }
          } else {
            setIsOpen(true);
          }
          break;
        }
        case 'Escape':
          e.preventDefault();
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
      }
    },
    [disabled, isOpen],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const firstItem = listRef.current?.firstElementChild as HTMLLIElement | null;
        firstItem?.focus();
        e.stopPropagation();
      }
    },
    [],
  );

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          setIsOpen((prev) => !prev);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) setIsOpen(true);
          break;
        case 'Escape':
          setIsOpen(false);
          break;
      }
    },
    [disabled, isOpen],
  );

  return (
    <div className={`w-full ${className}`}>
      <div ref={containerRef} className="relative">
        {/* Trigger button */}
        <button
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          disabled={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
          onKeyDown={handleTriggerKeyDown}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
            border-border-default hover:border-border-focus/50
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            bg-surface-overlay border text-text-primary`}
        >
          <span className={selectedOption ? 'text-text-primary' : 'text-text-muted truncate'}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 ml-2 text-text-muted transition-transform duration-200 ${
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

        {/* Dropdown */}
        {isOpen && (
          <div
            className="absolute z-40 mt-1 w-full bg-surface-raised border border-border-default rounded-lg shadow-lg overflow-hidden"
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={handleKeyDown}
          >
            {/* Search input */}
            <div className="p-2 border-b border-border-subtle">
              <input
                ref={searchInputRef}
                id={searchInputId}
                type="text"
                role="searchbox"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="w-full px-3 py-1.5 text-sm rounded-md bg-surface-base border border-border-default text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus transition-colors duration-150"
                aria-label={searchPlaceholder}
              />
            </div>

            {/* Options list */}
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              className="max-h-60 overflow-y-auto py-1"
            >
              {filteredOptions.length === 0 ? (
                <li className="px-3 py-8 text-sm text-text-muted text-center">
                  <svg
                    className="h-6 w-6 mx-auto mb-2 text-text-dim"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                    />
                  </svg>
                  <span>Nessun risultato</span>
                </li>
              ) : (
                filteredOptions.map((opt, idx) => (
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
                      listRef.current
                        ?.querySelector('[aria-selected="true"]')
                        ?.scrollIntoView({ block: 'nearest' });
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
          </div>
        )}
      </div>
    </div>
  );
}

SearchableSelect.displayName = 'SearchableSelect';

export { SearchableSelect };
export type { SearchableSelectProps, SearchableSelectOption };
