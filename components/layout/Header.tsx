import Navbar from "../navigation/Navbar";

const Header = () => {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 py-3 shadow-[0_1px_0_0_var(--border)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/80">
      <div className="page-wrapper">
        <Navbar />
      </div>
    </header>
  );
};

export default Header;
