# Monochrome Design System

A comprehensive design language for consistent UI/UX across the Monochrome music streaming application.

## Design Tokens

### Typography Scale

| Token         | Value           | Usage                        |
| ------------- | --------------- | ---------------------------- |
| `--text-xs`   | 0.75rem (12px)  | Captions, badges, timestamps |
| `--text-sm`   | 0.875rem (14px) | Secondary text, labels       |
| `--text-base` | 1rem (16px)     | Body text (default)          |
| `--text-md`   | 1.125rem (18px) | Lead paragraphs              |
| `--text-lg`   | 1.25rem (20px)  | Small headings               |
| `--text-xl`   | 1.5rem (24px)   | H4, card titles              |
| `--text-2xl`  | 1.875rem (30px) | H3                           |
| `--text-3xl`  | 2.25rem (36px)  | H2                           |
| `--text-4xl`  | 3rem (48px)     | H1                           |
| `--text-5xl`  | 3.75rem (60px)  | Display text                 |

### Font Weights

| Token             | Value |
| ----------------- | ----- |
| `--font-normal`   | 400   |
| `--font-medium`   | 500   |
| `--font-semibold` | 600   |
| `--font-bold`     | 700   |

### Spacing Scale

| Token        | Value   | Pixels |
| ------------ | ------- | ------ |
| `--space-1`  | 0.25rem | 4px    |
| `--space-2`  | 0.5rem  | 8px    |
| `--space-3`  | 0.75rem | 12px   |
| `--space-4`  | 1rem    | 16px   |
| `--space-5`  | 1.25rem | 20px   |
| `--space-6`  | 1.5rem  | 24px   |
| `--space-8`  | 2rem    | 32px   |
| `--space-10` | 2.5rem  | 40px   |
| `--space-12` | 3rem    | 48px   |
| `--space-16` | 4rem    | 64px   |

### Border Radius Scale

| Token           | Value  | Usage                   |
| --------------- | ------ | ----------------------- |
| `--radius-none` | 0      | Sharp corners           |
| `--radius-xs`   | 2px    | Small badges, tags      |
| `--radius-sm`   | 4px    | Inputs, small buttons   |
| `--radius-md`   | 8px    | Cards, panels (default) |
| `--radius-lg`   | 12px   | Large cards, modals     |
| `--radius-xl`   | 16px   | Hero elements           |
| `--radius-2xl`  | 24px   | Extra large elements    |
| `--radius-full` | 9999px | Circles, pills          |

### Transition Timing

| Token                | Value |
| -------------------- | ----- |
| `--duration-instant` | 0ms   |
| `--duration-fast`    | 150ms |
| `--duration-normal`  | 300ms |
| `--duration-slow`    | 500ms |

### Easing Functions

| Token             | Value                                   | Usage                 |
| ----------------- | --------------------------------------- | --------------------- |
| `--ease-linear`   | linear                                  | Continuous animations |
| `--ease-in`       | cubic-bezier(0.4, 0, 1, 1)              | Entering elements     |
| `--ease-out`      | cubic-bezier(0, 0, 0.2, 1)              | Exiting elements      |
| `--ease-in-out`   | cubic-bezier(0.4, 0, 0.2, 1)            | Standard transitions  |
| `--ease-out-back` | cubic-bezier(0.34, 1.56, 0.64, 1)       | Bouncy effects        |
| `--ease-elastic`  | cubic-bezier(0.68, -0.55, 0.265, 1.55)  | Playful animations    |
| `--ease-spring`   | cubic-bezier(0.175, 0.885, 0.32, 1.275) | Snappy interactions   |

### Shadows

| Token            | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `--shadow-none`  | none                                                                |
| `--shadow-xs`    | 0 1px 2px 0 rgb(0 0 0 / 0.05)                                       |
| `--shadow-sm`    | 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)       |
| `--shadow-md`    | 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)    |
| `--shadow-lg`    | 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)  |
| `--shadow-xl`    | 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1) |
| `--shadow-2xl`   | 0 25px 50px -12px rgb(0 0 0 / 0.25)                                 |
| `--shadow-inner` | inset 0 2px 4px 0 rgb(0 0 0 / 0.05)                                 |
| `--shadow-glow`  | 0 0 20px rgb(var(--highlight-rgb) / 0.5)                            |

### Z-Index Scale

| Token          | Value | Usage           |
| -------------- | ----- | --------------- |
| `--z-hide`     | -1    | Hidden elements |
| `--z-base`     | 0     | Default         |
| `--z-docked`   | 10    | Docked elements |
| `--z-dropdown` | 1000  | Dropdowns       |
| `--z-sticky`   | 1100  | Sticky headers  |
| `--z-banner`   | 1200  | Banners         |
| `--z-overlay`  | 1300  | Overlays        |
| `--z-modal`    | 1400  | Modals          |
| `--z-popover`  | 1500  | Popovers        |
| `--z-tooltip`  | 1600  | Tooltips        |
| `--z-toast`    | 1700  | Toasts          |

## Component Tokens

### Buttons

| Token              | Value                         |
| ------------------ | ----------------------------- |
| `--btn-height-sm`  | 32px                          |
| `--btn-height-md`  | 40px                          |
| `--btn-height-lg`  | 48px                          |
| `--btn-padding-sm` | var(--space-2) var(--space-3) |
| `--btn-padding-md` | var(--space-3) var(--space-4) |
| `--btn-padding-lg` | var(--space-4) var(--space-6) |

### Inputs

| Token             | Value                         |
| ----------------- | ----------------------------- |
| `--input-height`  | 40px                          |
| `--input-padding` | var(--space-3) var(--space-4) |

### Cards

| Token            | Value            |
| ---------------- | ---------------- |
| `--card-padding` | var(--space-4)   |
| `--card-gap`     | var(--space-4)   |
| `--card-radius`  | var(--radius-lg) |

### Modals

| Token                  | Value            |
| ---------------------- | ---------------- |
| `--modal-padding`      | var(--space-6)   |
| `--modal-radius`       | var(--radius-xl) |
| `--modal-max-width-sm` | 400px            |
| `--modal-max-width-md` | 500px            |
| `--modal-max-width-lg` | 600px            |
| `--modal-max-width-xl` | 800px            |

## Utility Classes

### Typography

```css
.text-xs, .text-sm, .text-base, .text-md, .text-lg, .text-xl, .text-2xl, .text-3xl, .text-4xl
.font-normal, .font-medium, .font-semibold, .font-bold
.leading-none, .leading-tight, .leading-snug, .leading-normal, .leading-relaxed
```

### Spacing

```css
.m-0, .m-1, .m-2, .m-3, .m-4, .m-6, .m-8
.mt-0, .mt-1, .mt-2, .mt-3, .mt-4, .mt-6
.mb-0, .mb-1, .mb-2, .mb-3, .mb-4, .mb-6
.ml-0, .ml-2, .ml-4
.mr-0, .mr-2, .mr-4
.mx-0, .mx-2, .mx-4
.my-0, .my-2, .my-4
.p-0, .p-1, .p-2, .p-3, .p-4, .p-6
.px-0, .px-2, .px-3, .px-4
.py-0, .py-1, .py-2, .py-3
.gap-0, .gap-1, .gap-2, .gap-3, .gap-4, .gap-6
```

### Border Radius

```css
.rounded-none, .rounded-xs, .rounded-sm, .rounded-md, .rounded-lg, .rounded-xl, .rounded-full
```

### Shadows

```css
.shadow-none, .shadow-xs, .shadow-sm, .shadow-md, .shadow-lg, .shadow-xl
```

### Display & Flex

```css
.block, .inline-block, .inline, .flex, .inline-flex, .grid, .hidden
.flex-row, .flex-col, .flex-wrap, .flex-nowrap
.items-start, .items-center, .items-end
.justify-start, .justify-center, .justify-end, .justify-between
.flex-1, .flex-auto, .flex-none
```

### Text

```css
.text-left, .text-center, .text-right
.truncate
.line-clamp-2, .line-clamp-3
.text-muted, .text-highlight
```

### Other

```css
.cursor-pointer, .cursor-default
.transition-fast, .transition-normal, .transition-slow
```

## Best Practices

### DO:

- Use design tokens for all values
- Use utility classes for common patterns
- Keep component styles in CSS, not inline JS
- Use semantic HTML elements
- Maintain consistent spacing using the spacing scale

### DON'T:

- Use hardcoded pixel values
- Use inline styles in JavaScript
- Mix different border-radius values arbitrarily
- Skip the spacing scale with custom values
- Use arbitrary font sizes outside the type scale

## Migration Guide

### From hardcoded values:

```css
/* Before */
.element {
    padding: 16px;
    font-size: 14px;
    border-radius: 4px;
    margin-bottom: 24px;
}

/* After */
.element {
    padding: var(--space-4);
    font-size: var(--text-sm);
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-6);
}
```

### From inline styles:

```javascript
// Before
element.style.cssText = 'display: flex; gap: 8px; padding: 16px;';

// After
element.classList.add('flex', 'gap-2', 'p-4');
```

## Themes

The design system supports multiple themes. Each theme defines color variables while maintaining consistent spacing, typography, and other design tokens.

Available themes:

- `monochrome` (default)
- `dark`
- `ocean`
- `purple`
- `forest`
- `mocha`
- `machiatto`
- `frappe`
- `latte`
- `white`

## Notes

- The `--highlight-rgb` variable must be in comma-separated RGB format (e.g., `245, 245, 245`) for use with `rgb()` function
- All spacing values are in rem units for accessibility
- The design system is mobile-first and responsive
