import type { JSX } from 'preact';

export interface IconProps {
    svg: string;
    size?: number;
    className?: string;
    decorative?: boolean;
}

export function Icon({ svg, size = 20, className = '', decorative = true }: IconProps) {
    const style = { '--icon-size': `${size}px` } as JSX.CSSProperties;

    return (
        <span
            aria-hidden={decorative ? 'true' : undefined}
            className={`ui-icon ${className}`.trim()}
            dangerouslySetInnerHTML={{ __html: svg }}
            style={style}
        />
    );
}
