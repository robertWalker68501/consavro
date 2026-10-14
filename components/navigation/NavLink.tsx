"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinkProps {
  href: string;
  label: string;
  classNames?: string;
  onClick?: () => void;
  isMobile?: boolean;
}

const NavLink = ({
  href,
  label,
  classNames,
  onClick,
  isMobile,
}: NavLinkProps) => {
  const pathname = usePathname();
  const [currentHash, setCurrentHash] = useState("");

  useEffect(() => {
    const updateHash = () => setCurrentHash(window.location.hash);
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, [pathname]);

  const [linkPath, linkHash = ""] = href.split("#");
  const targetPath = linkPath || "/";
  const isActive =
    pathname === targetPath &&
    (linkHash ? currentHash === `#${linkHash}` : !currentHash);

  return (
    <Link
      href={href}
      className={cn(
        "text-xs text-muted-foreground font-bold uppercase hover:text-primary transition-colors duration-300",
        isActive && "text-primary",
        isMobile && "text-lg",
        classNames,
      )}
      onClick={() => {
        setCurrentHash(linkHash ? `#${linkHash}` : "");
        onClick?.();
      }}
    >
      {label}
    </Link>
  );
};

export default NavLink;
