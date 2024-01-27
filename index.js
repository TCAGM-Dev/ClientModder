require("dotenv").config()
const fs = require("fs")
const path = require("path")
const https = require("https")
const rl = require("node:readline/promises").createInterface({
    input: process.stdin,
    output: process.stdout
})

async function pipeToString(stream) {
    let data = ""
    stream.on("data", chunk => {
        data += chunk
    })
    await new Promise(r => stream.on("end", r))
    return data
}

function apiGet(url, options) {
    const request = https.get(url, options)
    return new Promise(async (resolve, reject) => {
        const response = await new Promise(r => request.on("response", r))

        if (response.statusCode != 200) return reject()

        response.setTimeout(5000, reject)
        const data = await pipeToString(response)
        return resolve(JSON.parse(data))
    })
}

async function curseforgeGet(path, options = {}) {
    if (!options.headers) options.headers = {}
    options.headers["x-api-key"] = process.env.CURSEFORGE_API_KEY
    return apiGet("https://api.curseforge.com" + path, options)
}

async function download(source, destination) {
    const request = https.get(source)
    request.setTimeout(5000, () => {
        request.destroy()
        download(source, destination)
    })
    const response = await new Promise(r => request.on("response", r))
    if (response.statusCode == 302 || response.statusCode == 301) {
        return download(response.headers.location, destination)
    }
    response.pipe(fs.createWriteStream(destination))
    return new Promise(r => request.on("close", r))
}

(async ()=>{

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
    } else if (datasource == "http") {
        if (!process.env.JSON_PATH) {
            throw new Error("Mod json file path not present")
        }
        const request = https.get(process.env.JSON_PATH)
        const response = await new Promise(r => request.on("response", r))
        if (response.statusCode != 200) {
            throw new Error(`HTTP ${response.statusCode} recieved from "${process.env.JSON_PATH}"`)
        }
        const text = await pipeToString(response)
        if (!text || text == "") {
            throw new Error(`No data recieved from "${process.env.JSON_PATH}"`)
        }
        const data = JSON.parse(text)
        if (!data) {
            throw new Error(`Invalid data recieved from "${process.env.JSON_PATH}"`)
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

    const supportedversions = data.supportedGameVersions
    const supportedmodloaders = data.supportedModLoaders

    if (supportedversions == null || typeof supportedversions != "object" || supportedversions.length <= 0) {
        throw new Error(`Invalid supported versions array "${supportedversions}"`)
    }
    if (supportedmodloaders == null || typeof supportedmodloaders != "object" || supportedmodloaders.length <= 0) {
        throw new Error(`Invalid supported modloaders array "${supportedmodloaders}"`)
    }

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
            modloader = [null, "forge", "cauldron", "liteloader", "fabric", "quilt", "neoforge"][basemodloader.type]
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

    const curseforgemodloaderid = [null, "forge", "cauldron", "liteloader", "fabric", "quilt", "neoforge"].findIndex(v => v == modloader)

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
            const versions = await apiGet(`https://api.modrinth.com/v2/project/${mod.id}/version?loaders=${encodeURIComponent(JSON.stringify([modloader]))}&game_versions=${encodeURIComponent(JSON.stringify([mcversion]))}`).catch(console.error())

            if (versions.length > 0) {
                console.log(`Downloading "${mod.name}"`)
                
                const url = versions[0].files[0].url
                downloads.push(download(url, path.join(modfolderpath, path.basename(decodeURIComponent(url)))))
                installedmods.push(mod.id)
            }
        } else if (mod.platform == "curseforge") {
            if (process.env.CURSEFORGE_API_KEY == null) {
                console.log(`Failed to download "${mod.name}" because of missing Curseforge API key`)
            } else {
                const mdata = await curseforgeGet(`/v1/mods/${mod.id}`)
                const files = mdata.data.latestFilesIndexes
                const matchingfiles = files.filter(file => file.gameVersion == mcversion && file.modLoader == curseforgemodloaderid)
                if (matchingfiles.length > 0) {
                    console.log(`Downloading "${mod.name}"`)

                    const file = matchingfiles[0]
                    const url = (await curseforgeGet(`/v1/mods/${mod.id}/files/${file.fileId}/download-url`)).data
                    downloads.push(download(url, path.join(modfolderpath, path.basename(url))))
                    installedmods.push(mod.id)
                }
            }
        }
    }

    await Promise.all(downloads)
    console.log(`Downloaded ${installedmods.length} mods`)

    console.log("Finished")
    process.exit()

})()