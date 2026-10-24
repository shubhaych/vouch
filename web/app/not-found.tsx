import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted">That page is not part of Vouch.</p>
      <Link href="/" className="mt-6 inline-block font-semibold text-accent underline">Back to home</Link>
    </div>
  );
}
