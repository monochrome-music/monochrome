# Monochrome Theme Creation Guide

Welcome to the Monochrome Theme Guide! This document explains how to create, style, and upload custom themes for Monochrome.

## Getting Started

Themes in Monochrome are essentially CSS snippets that override the default CSS variables (custom properties). You can create a theme by defining these variables inside a `:root` block.

### Basic Structure

```css
:root {
    /* Base Colors */
    --background: #0a0a0a;
    --foreground: #ededed;
    
    /* UI Elements */
    --card: #1a1a1a;
    --card-foreground: #ededed;
    --border: #2a2a2a;
    
    /* Accents */
    --primary: #3b82f6;
    --primary-foreground: #ffffff;
    --secondary: #2a2a2a;
    --secondary-foreground: #ededed;
    
    /* Text */
    --muted: #2a2a2a;
    --muted-foreground: #a0a0a0;
    
    /* Special */
    --highlight: #3b82f6;
    --ring: #3b82f6;
    --radius: 8px;
    --font-family: 'Inter', sans-serif;
}
```

## CSS Variables Reference

| Variable | Description |
| :--- | :--- |
| `--background` | The main background color for your theme. |
| `--foreground` | The main text color. |
| `--card` | Background color for cards, modals, and panels. |
| `--card-foreground` | Text color inside cards. |
| `--border` | Color for borders and separators. |
| `--primary` | Main accent color (buttons, active states). |
| `--primary-foreground` | Text color on top of primary elements. |
| `--secondary` | Secondary background (hover states, secondary buttons). |
| `--secondary-foreground` | Text color on secondary elements. |
| `--muted` | Muted background color (placeholders, skeletons). |
| `--muted-foreground` | Muted text color (subtitles, metadata). |
| `--highlight` | Color used for text highlighting and focus rings. |
| `--radius` | Border radius for cards and buttons (e.g., `8px`, `0px`). |
| `--font-family` | Font stack for the theme. |

## Using the Theme Editor

1.  **Open the Theme Store**: Go to Settings > Appearance > Open Theme Store.
2.  **Go to Upload Tab**: Click on the "Upload" tab.
3.  **Use the Toolbar**:
    *   **Colors**: Use the color pickers to quickly set the main colors.
    *   **Styles**: Use the dropdowns to set font and border radius.
    *   **Template**: Click "Template" to insert a starter CSS block.
    *   **Preview**: Click "Preview" to see your changes in real-time on a sample card.
4.  **Manual Editing**: You can manually edit the CSS in the text area for fine-grained control.

## Uploading Your Theme

1.  **Name & Description**: Give your theme a unique name and a brief description.
2.  **Author Website**: Optionally provide a link to your website.
    *   *Note:* If you have a Monochrome profile, your name will automatically link to it.
3.  **Submit**: Click "Upload Theme".

Once uploaded, your theme will be available for everyone to browse and apply!