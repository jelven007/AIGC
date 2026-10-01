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
            "group toast group-[.toaster]:bg-background/95 group-[.toaster]:backdrop-blur-md group-[.toaster]:text-foreground group-[.toaster]:border-border/80 group-[.toaster]:shadow-2xl group-[.toaster]:rounded-2xl group-[.toaster]:py-4 group-[.toaster]:px-5 group-[.toaster]:min-h-[64px] group-[.toaster]:text-[13.5px] group-[.toaster]:font-semibold group-[.toaster]:flex group-[.toaster]:items-center group-[.toaster]:gap-3.5 hover:scale-[1.01] transition-all",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-[11.5px] group-[.toast]:font-normal group-[.toast]:mt-1",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:text-emerald-500 group-[.toaster]:border-emerald-500/20 group-[.toaster]:bg-emerald-500/[0.04]",
          error: "group-[.toaster]:text-rose-500 group-[.toaster]:border-rose-500/20 group-[.toaster]:bg-rose-500/[0.04]",
          warning: "group-[.toaster]:text-amber-500 group-[.toaster]:border-amber-500/20 group-[.toaster]:bg-amber-500/[0.04]",
          info: "group-[.toaster]:text-sky-500 group-[.toaster]:border-sky-500/20 group-[.toaster]:bg-sky-500/[0.04]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
