(async ()=>{

    require("dotenv").config()
    const fs = require("fs")
    const path = require("path")
    const https = require("https")
    const rl = require("node:readline/promises").createInterface({
        input: process.stdin,
        output: process.stdout
    })

    const moddatasource = process.env.MOD_JSON_SOURCE

    let moddata
    if (moddatasource == "file") {
        if (!process.env.MOD_JSON_PATH) {
            throw new Error("Mod json file path not present")
        }
        if (fs.existsSync(process.env.MOD_JSON_PATH)) {
            const text = fs.readFileSync(process.env.MOD_JSON_PATH)
            moddata = JSON.parse(text)
        } else {
            throw new Error(`Mod json file at path "${process.env.MOD_JSON_PATH}" is not present`)
        }
    } else {
        throw new Error(`Invalid mod data source "${moddatasource}"`)
    }

    const supportedversions = ["1.20.4", "1.20.3", "1.20.2", "1.20.1", "1.20", "1.19.4", "1.19.3", "1.19.2", "1.19.1", "1.19", "1.18.2", "1.18.1", "1.18", "1.17.1", "1.17", "1.16.5", "1.16.4", "1.16.3", "1.16.2", "1.16.1", "1.16", "1.15.2", "1.15.1", "1.15", "1.14.4", "1.14.3", "1.14.2", "1.14.1", "1.14", "1.13.2", "1.13.1", "1.13", "1.12.2", "1.12.1", "1.12"]
    const supportedmodloaders = ["forge", "fabric", "quilt", "neoforge"]

    let modloader
    let mcversion

    while (true) {
        const answer = await rl.question("Modloader? ")
        if (supportedmodloaders.includes(answer)) {
            modloader = answer
            break
        } else {
            console.log("Modloader invalid or not supported")
        }
    }

    while (true) {
        const answer = await rl.question("Minecraft version? ")
        if (supportedversions.includes(answer)) {
            mcversion = answer
            break
        } else {
            console.log("Version invalid or not supported")
        }
    }

    const folderpath = path.resolve(process.env.MOD_FOLDER_PATH)
    const installedmods = []

    for (const mod of moddata) {
        if (mod.incompatible && mod.incompatible.some(v => installedmods.includes(v))) {
            continue
        }
        if (mod.dependencies && !mod.dependencies.some(v => installedmods.includes(v))) {
            continue
        }
        if (mod.ask == true) {
            const answer = await rl.question(`Include "${mod.name}? (y/n) `)
            if (answer == "n") continue
        }
        console.log(`Downloading "${mod.name}"`)

        if (mod.platform == "modrinth") {
            const request = https.get(`https://api.modrinth.com/v2/project/${mod.id}/version?loaders=${encodeURIComponent(JSON.stringify([modloader]))}&game_versions=${encodeURIComponent(JSON.stringify([mcversion]))}`)
            const response = await new Promise(r => request.on("response", r))
            if (response.statusCode == 200) {
                let data = ""
                response.on("data", chunk => {
                    data += chunk
                })
                await new Promise(r => response.on("end", r))

                const versions = JSON.parse(data)

                if (versions.length > 0) {
                    const url = versions[0].files[0].url
                    https.get(url, res => {
                        res.pipe(fs.createWriteStream(path.join(folderpath, path.basename(url))))
                    })
                    installedmods.push(mod.id)
                }
            } else {
                response.pipe(process.stdout)
            }
        }
    }

    setTimeout(() => {
        console.log(`Installed ${installedmods.length} mods`)
        process.exit()
    }, 500)

})()