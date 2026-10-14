import Link from "next/link";

const Footer = () => {
  return (
    <footer className="border-t border-border bg-background py-4 text-sm text-muted-foreground">
      <div className="page-wrapper">
        <p>
          Consavro &copy; 2026 |{" "}
          <Link href="/" className="hover:text-primary">
            Privacy Policy
          </Link>
        </p>
      </div>
    </footer>
  );
};

export default Footer;
