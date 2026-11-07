import Head from 'next/head';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0B0C10" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
