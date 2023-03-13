import { Context, h, Schema, Session } from 'koishi'
import { } from '@mirror_cy/gpt'

export const name = 'bibigpt'
export const using = ['gpt'] as const
export async function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh', require('./locales/zh'))
  const cmd = ctx.command('bibigpt')
    .option('总结个屁', '-s 直接给我字幕我自己看')
    .action(async ({ session, options }, bvId) => {
      const id = `${session.platform}-${session.userId}-${session.selfId}-${name}`

      if (!bvId) return session.execute('help bibigpt')

      try { bvId = getBVId(bvId) } catch (_) { return session.text('.invalid-bvid') }

      let cover: string, title: string, subSubtitlesText: string[]
      try { ({ cover, title, subSubtitlesText } = await getSubtitle(bvId, session)) }
      catch (e) { return e.message }

      if (options.总结个屁) return subSubtitlesText.join('\n')

      session.send(session.text('.loading', { count: subSubtitlesText.length }))

      let summarize = ''
      for (const text of subSubtitlesText) {
        const prompt = session.text('.prompt.base', { title, subtitles: text })
        summarize += (await ctx.gpt.ask(prompt, id)).text + '\n'
      }

      session.send(h('segment',
        h.image(cover),
        h.text('\n视频标题：' + title),
        h.text('\n太长不看：\n' + removeNonListLines(summarize))
      ))
      console.log(await ctx.gpt.reset(id))
    })

  async function getSubtitle(bvId: string, session: Session) {
    const { data: biliRes } = await ctx.http.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`, {
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "Host": "api.bilibili.com",
        "Cookie": `SESSDATA=${config.SESSDATA || 'b233f807%2C1693907636%2C5aa96%2A32'}`
      }
    })
    const subtitleList = biliRes?.subtitle?.list ?? []
    if (subtitleList.length === 0) throw new Error(session.text('.no-subtitle'))
    const betterSubtitle = subtitleList.find(({ lan }: { lan: string }) => lan === "zh-CN") || subtitleList[0]
    const subtitleResponse = await ctx.http.get(betterSubtitle.subtitle_url)
    const subtitles = subtitleResponse?.body.map(({ from, content }: { from: number; content: string }) => {
      const minutes = Math.floor(from / 60)
      const seconds = Math.floor(from % 60).toString().padStart(2, '0')
      return { text: `${minutes}:${seconds} ${content}` }
    })
    const subSubtitles = splitSubtitles(subtitles)
    const subSubtitlesText: string[] = subSubtitles.map((subtitles) => subtitles.map(({ text }) => text).join('\n'))
    const title: string = biliRes?.title
    const cover = 'data:image/jpeg;base64,' + Buffer.from((await ctx.http.file(biliRes?.pic)).data).toString('base64')
    return { cover, title, subSubtitlesText }
  }

  const getBVId = (value: string) => {
    const match = value.match(/BV([a-zA-Z0-9]{10})/)
    if (match[0].length != 12) throw new Error('Invalid BVId')
    return match[0]
  }

  const splitSubtitles = (subtitles) => {
    const maxLen = 80
    const length = subtitles.length
    if (length <= maxLen) {
      return [subtitles]
    } else {
      const numSplits = Math.ceil(length / maxLen)
      const splitSize = Math.ceil(length / numSplits)
      const result = []

      for (let i = 0; i < numSplits; i++) {
        const start = i * splitSize
        const end = start + splitSize
        result.push(subtitles.slice(start, end))
      }
      return result
    }
  }

  function removeNonListLines(str) {
    const lines = str.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].match(/^\s*[-+*]\s+/)) {
        lines.splice(i, 1)
        i--
      }
    }
    return lines.join("\n")
  }
}

export interface Config {
  SESSDATA: string
}

export const Config: Schema<Config> = Schema.object({
  SESSDATA: Schema.string().description('需要在 B 站网页端获取，留空会用我的。')
})
