import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl group-[.toaster]:py-4 group-[.toaster]:px-5 group-[.toaster]:min-h-[64px] group-[.toaster]:text-sm group-[.toaster]:font-medium group-[.toaster]:flex group-[.toaster]:items-center group-[.toaster]:gap-3 transition-colors",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-xs group-[.toast]:font-normal group-[.toast]:mt-1",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-success/40 [&_[data-icon]]:text-success",
          error: "group-[.toaster]:border-destructive/40 [&_[data-icon]]:text-destructive",
          warning: "group-[.toaster]:border-warning/40 [&_[data-icon]]:text-warning",
          info: "group-[.toaster]:border-info/40 [&_[data-icon]]:text-info",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
