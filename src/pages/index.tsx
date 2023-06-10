import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>Explore Suspense</title>
        <meta name='description' content='Experimenting with react Suspense' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <link rel='icon' href='/favicon.ico' />
      </Head>
      <main>
        <p>This is it.</p>
      </main>
    </>
  );
}
