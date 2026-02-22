### the project
spool is the next generation of courses. my goal was to hijack the dopamine loop of the infinite scroll and redirect it toward actual human progress. over the weekend, i shipped a native swiftui app with a hono backend that delivers an algorithmic feed of bite-sized, interactive video lessons.

### the team
just me, solo hacker. i built the swiftui frontend, the hono/sql backend, and the entire programmatic video rendering pipeline.

### acknowledgements
huge shoutout to 11labs (voice generation) and revideo (programmatic video creation) for powering the media engine. relied heavily on yt-dlp for pulling high-quality background b-roll. for the actual building, i went all-in on ai tools as my co-pilots: claude code, gemini, open code, amp code, and cursor.

### optional reflection

- motivation & future: i chose this because the traditional 10-hour video course is dead—nobody finishes them. i wanted to build 'generation 3' of education: an algorithmic knowledge network that pays creators for user comprehension, not just watch time. in the future, i'm building out the full creator dashboard where anyone can paste a youtube link, claim a content bounty, and let spool auto-slice it into the ecosystem.

- tricky bug: the absolute hardest wall i hit was video generation latency. for an infinite scroll to be viable, i needed to generate a new video in under 30 seconds. i tried rendering it locally. i tried throwing it on modal (a hosted gpu). i tried aws lambda. none of these options were fast enough to keep up with a user swiping. the design limitation i eventually had to create was restricting the app to pre-generated topics (like black holes and linear algebra) that the user chooses from. it's a shame i couldn't get it fully on-the-fly for any random topic yet, but such is life in a weekend hackathon. restricting the topics allowed me to actually ship a buttery smooth experience.

- fun hacker experience: i didn't end up winning any of the swag hats, but the team i was sharing a room with did, which was awesome. honestly, just working alongside another team in the same room was such a good vibe. peaking at 2am last night watching music videos together while our code compiled was definitely the highlight of the weekend.
