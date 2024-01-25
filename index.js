(async ()=>{

    require("dotenv").config()
    const fs = require("fs")
    const path = require("path")
    const https = require("https")
    const rl = require("node:readline/promises").createInterface({
        input: process.stdin,
        output: process.stdout
    })

    const datasource = process.env.JSON_SOURCE

    let data
    if (datasource == "file") {
        if (!process.env.JSON_PATH) {
            throw new Error("Mod json file path not present")
        }
        if (fs.existsSync(process.env.JSON_PATH)) {
            const text = fs.readFileSync(process.env.JSON_PATH)
            data = JSON.parse(text)
        } else {
            throw new Error(`Mod json file at path "${process.env.JSON_PATH}" is not present`)
        }
    } else {
        throw new Error(`Invalid mod data source "${datasource}"`)
    }

    const folderpath = path.resolve(process.env.INSTANCE_FOLDER_PATH)
    const modfolderpath = path.join(folderpath, "mods")
    const configfolderpath = path.join(folderpath, "config")

    {
        const files = fs.readdirSync(modfolderpath)
        if (files.length > 0) {
            const answer = (await rl.question("There are already mods installed in the selected instance. Delete? (y/n) ")).toLowerCase()
            if (answer == "y" || answer == "yes") {
                await Promise.all(await files.map(filename => new Promise(r => fs.rm(path.join(modfolderpath, filename), r))))
            } else {
                process.exit()
            }
        }
    }
    if (fs.readdirSync(modfolderpath).length > 0) {
        throw new Error("Could not delete files")
    }

    const supportedversions = ["1.20.4", "1.20.3", "1.20.2", "1.20.1", "1.20", "1.19.4", "1.19.3", "1.19.2", "1.19.1", "1.19", "1.18.2", "1.18.1", "1.18", "1.17.1", "1.17", "1.16.5", "1.16.4", "1.16.3", "1.16.2", "1.16.1", "1.16", "1.15.2", "1.15.1", "1.15", "1.14.4", "1.14.3", "1.14.2", "1.14.1", "1.14", "1.13.2", "1.13.1", "1.13", "1.12.2", "1.12.1", "1.12"]
    const supportedmodloaders = ["forge", "fabric", "quilt", "neoforge"]

    let modloader
    let mcversion

    {
        const filepath = path.join(folderpath, "profile.json")
        if (fs.existsSync(filepath)) {
            const data = JSON.parse(fs.readFileSync(filepath))
            modloader = data.metadata.loader
            console.log(`Modloader "${modloader}" detected`)
            if (modloader == "vanilla") {
                console.warn("Vanilla Modrinth instance detected")
                process.exit()
            }
            mcversion = data.metadata.game_version
            console.log(`Version "${mcversion}" detected`)
        }
    }
    {
        const filepath = path.join(folderpath, "minecraftinstance.json")
        if (fs.existsSync(filepath)) {
            const data = JSON.parse(fs.readFileSync(filepath))
            const basemodloader = data.baseModLoader
            if (basemodloader == null) {
                console.warn("Vanilla Curseforge instance detected")
                process.exit()
            }
            modloader = ["forge", null, null, "fabric", "quilt", "neoforge"][basemodloader.type - 1]
            console.log(`Modloader "${modloader}" detected`)
            mcversion = data.BaseModLoader.minecraftVersion
            console.log(`Version "${mcversion}" detected`)
        }
    }

    if (modloader == null || !supportedmodloaders.includes(modloader)) {
        while (true) {
            const answer = await rl.question("Modloader? ")
            if (supportedmodloaders.includes(answer)) {
                modloader = answer
                break
            } else {
                console.log("Modloader invalid or not supported")
            }
        }
    }

    if (mcversion == null || !supportedversions.includes(mcversion)) {
        while (true) {
            const answer = await rl.question("Minecraft version? ")
            if (supportedversions.includes(answer)) {
                mcversion = answer
                break
            } else {
                console.log("Version invalid or not supported")
            }
        }
    }

    let categories = ["basic", "library", "optimization", "visual", "qol", "utility", "other"]
    {
        const answer = (await rl.question("Include only optimization mods? (y/n) ")).toLowerCase()
        if (answer == "y" || answer == "yes") categories = ["basic", "library", "optimization"]
    }

    
    const installedmods = []
    const downloads = []

    for (const mod of data.mods) {
        if (!categories.includes(mod.type)) {
            continue
        }
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
                    console.log(`Downloading "${mod.name}"`)
                    
                    const url = versions[0].files[0].url
                    function downloadMod() {
                        const request = https.get(url)
                        request.on("response", res => {
                            res.pipe(fs.createWriteStream(path.join(modfolderpath, decodeURIComponent(path.basename(url)))))
                        })
                        request.setTimeout(5000, () => {
                            request.destroy()
                            downloadMod()
                        })
                        downloads.push(new Promise(r => request.on("close", r)))
                    }
                    downloadMod()
                    installedmods.push(mod.id)
                }
            } else {
                response.pipe(process.stdout)
            }
        }
    }

    await Promise.all(downloads)
    console.log(`Downloaded ${installedmods.length} mods`)

    console.log("Finished")
    process.exit()

})()