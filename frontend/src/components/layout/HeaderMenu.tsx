import { useState, useEffect, useRef, useId } from 'react';

/**
 * Accessible name for a control that opens a new tab. Lives here because the
 * header's direct links (Guide, Feedback) and its menu items must announce
 * themselves identically.
 */
export const newTabLabel = (title: string) => `${title} (opens in a new tab)`;

export interface HeaderMenuItem {
  id: string;
  title: string;
  href: string;
  /**
   * Whether following this item leaves the current tab. Defaults to true,
   * which is right for every off-site destination. The App Store link opts
   * out: on iOS it hands off to the App Store app, so opening a tab for it
   * only strands an empty one behind.
   */
  newTab?: boolean;
  /**
   * Pulled to the top of the menu and followed by a separator. Used for
   * "Get the app", which is neither one of this app's routes nor a
   * Chautauqua resource and so belongs in neither group.
   */
  setApart?: boolean;
}

interface HeaderMenuProps {
  /** Text on the trigger button. */
  label: string;
  /** Describes the revealed group of links to assistive tech. */
  ariaLabel: string;
  items: HeaderMenuItem[];
  /** Size/colour overrides so the desktop and mobile triggers can differ. */
  triggerClassName?: string;
}

/**
 * A disclosure button revealing a group of links, shared by the header's
 * desktop "Chautauqua" menu and its mobile "More" menu so both get the same
 * keyboard and screen-reader behaviour.
 *
 * Deliberately *not* the `role="menu"` / `role="menuitem"` pattern that
 * `YearSelector` uses. That pattern is for menus of commands, and its roles
 * override the native link role — which is exactly the semantics #219 asks
 * us to restore. A group of navigation destinations is a disclosure: a
 * button with `aria-expanded`/`aria-controls`, revealing ordinary anchors.
 * The dismissal behaviour (outside click, Escape) matches `YearSelector`.
 */
export function HeaderMenu({ label, ariaLabel, items, triggerClassName }: HeaderMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // Close on outside click
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

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Collapsing synchronously would unmount the anchor from inside its own
  // click handler, which can cancel the navigation it just started — so the
  // close waits for the next task.
  const closeAfterNavigating = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 0);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={menuId}
        className={`bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1 ${triggerClassName ?? 'px-3 py-1 text-sm'}`}
      >
        {label}
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          id={menuId}
          aria-label={ariaLabel}
          className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-700 rounded-md shadow-lg py-1 z-50 border border-gray-200 dark:border-gray-600"
        >
          {items.map((item) => {
            const newTab = item.newTab !== false;
            return (
            <div key={item.id}>
              <a
                href={item.href}
                target={newTab ? '_blank' : undefined}
                rel={newTab ? 'noopener noreferrer' : undefined}
                onClick={closeAfterNavigating}
                // The warning goes in the accessible name rather than a
                // visually-hidden span: name computation concatenates inline
                // text without a separator, so the span reads as
                // "Programs(opens in a new tab)". The visible title stays the
                // prefix, which keeps voice control ("click Programs") working.
                aria-label={newTab ? newTabLabel(item.title) : undefined}
                className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${
                  item.setApart
                    ? 'font-medium text-green-700 dark:text-green-400'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                {item.title}
              </a>
              {item.setApart && (
                <hr role="separator" className="my-1 border-gray-200 dark:border-gray-600" />
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
