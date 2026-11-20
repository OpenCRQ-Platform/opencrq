export const UserAvatar = ({ name }: { name: string | null | undefined }) => {
  if (!name) {
    return null;
  }
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <p className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground txt-mini font-semibold shrink-0">
        {initial}
      </p>
      <p className="txt-default font-medium">{name}</p>
    </div>
  );
};
