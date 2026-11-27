import { Icon, type IconProps } from "@chakra-ui/react";

/** Shared vertical three-dot glyph for compact overflow controls. */
export function OverflowMenuIcon(props: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </Icon>
  );
}
