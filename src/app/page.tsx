import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function Home() {
  let result: { data: unknown; error: unknown }

  try {
    const { data, error } = await supabase
      .from('seasons')
      .select('id, name, status')
      .order('id')
    result = { data, error }
  } catch (err) {
    result = { data: null, error: String(err) }
  }

  return (
    <main className="p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4">DGLS — Supabase smoke test</h1>
      <pre className="bg-zinc-100 dark:bg-zinc-900 p-4 rounded text-sm overflow-auto">
        {JSON.stringify(result, null, 2)}
      </pre>
    </main>
  )
}
