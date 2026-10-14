"use client";

import { cn } from "cn";
import Image from "next/image";
import Link from "next/link";

interface SiteLogoProps {
  href: string;
  classNames?: string;
  onClick?: () => void;
  imgSrc?: string;
  imgAlt?: string;
  imgHeight?: number;
  imgWidth?: number;
  text?: string;
}

const SiteLogo = ({
  href,
  classNames,
  onClick,
  imgSrc = "/assets/images/logo.png",
  imgAlt = "Consavro Logo",
  imgHeight = 35,
  imgWidth = 35,
  text = "Consavro",
}: SiteLogoProps) => {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 text-2xl font-semibold",
        classNames,
      )}
      onClick={onClick}
    >
      <Image src={imgSrc} alt={imgAlt} height={imgHeight} width={imgWidth} style={{ width: "auto", height: imgHeight }} />
      {text}
    </Link>
  );
};

export default SiteLogo;
