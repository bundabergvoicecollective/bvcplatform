import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // The theme defines its colours as --color-*, through Tailwind v4's
      // @theme. This used to read var(--popover) and var(--border), which
      // exist nowhere, so every toast in the app — "Payment recorded", "Test
      // sent", every error — had a transparent background and printed its
      // text straight over whatever was behind it.
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "1rem",
        } as React.CSSProperties
      }
      {...props}
      toastOptions={{
        ...props.toastOptions,
        style: { boxShadow: "var(--shadow-overlay)", ...props.toastOptions?.style },
      }}
    />
  );
};

export { Toaster };
