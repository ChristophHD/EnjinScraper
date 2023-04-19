#! /usr/bin/env node

import packageJson from './package.json';
import { getConfig } from './src/util/config';
import { deleteFiles, ensureDirectory } from './src/util/files';
import { databaseConnection, initializeTables, insertRow, isModuleScraped, queryModuleIDs } from './src/util/database';
import { authenticateAPI, authenticateSite, getSiteID } from './src/scrapers/authenticate';
import { getForums } from './src/scrapers/forums';
import { getNews } from './src/scrapers/news';
import { getAllTickets } from './src/scrapers/tickets';
import { getApplicationResponses, getApplications } from './src/scrapers/applications';
import { getUsers } from './src/scrapers/users';
import { getComments } from './src/scrapers/comments';
import { getSiteData } from './src/scrapers/sitedata';
import { getFiles } from './src/scrapers/files';
import { getWikis } from './src/scrapers/wiki';
import { getGalleries } from './src/scrapers/galleries';
import { MessageType, statusMessage } from './src/util/console';

async function main(): Promise<void> {
    // Needed for exit handler
    process.stdin.resume();

    // Print Start Message
    statusMessage(MessageType.Info, `Starting ${packageJson.name} v${packageJson.version}...`);

    // Get config
    const config = await getConfig();

    // Login to API and get session ID
    const sessionID = config.sessionID ? config.sessionID : await authenticateAPI(config.domain, config.email, config.password);
    
    // Login to site and get PHPSESSID and csrf_token
    const siteAuth = config.siteAuth ? config.siteAuth : await authenticateSite(config.domain, config.email, config.password);

    // Get site ID
    const siteID = await getSiteID(config.domain);
    statusMessage(MessageType.Info, `Site ID: ${siteID}`);

    // Ensure needed directories exist
    ensureDirectory('./target/recovery');

    // Initialize database tables
    const database = await databaseConnection();
    await initializeTables(database);

    // Get site data
    if(await isModuleScraped(database, 'site_data')) {
        statusMessage(MessageType.Critical, 'Site data already scraped, moving on...');
    } else {
        await getSiteData(config.domain, siteAuth, database, siteID);
        await insertRow(database, 'scrapers', 'site_data', true);
    }

    // Get forums
    let forumModuleIDs = await queryModuleIDs(database, 'forum');
    config.excludeForumModuleIDs ? forumModuleIDs.filter(id => !config.excludeForumModuleIDs?.includes(id)) : {};
    if (forumModuleIDs.length === 0) {
        statusMessage(MessageType.Critical, 'No forum module IDs for site, skipping forum scraping...');
    } else if (config.disabledModules?.forums) {
        statusMessage(MessageType.Critical, 'Forums module disabled, skipping forum scraping...');
    } else if (await isModuleScraped(database, 'forums')) {
        statusMessage(MessageType.Critical, 'Forums already scraped, skipping forum scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping forums...');
        await getForums(database, config.domain, sessionID, forumModuleIDs);
        await insertRow(database, 'scrapers', 'forums', true);
        deleteFiles(['./target/recovery/forum_progress.json']);
        statusMessage(MessageType.Completion, 'Finished forum scraping');
    }

    //Get galleries
    if (config.disabledModules?.galleries) {
        statusMessage(MessageType.Critical, 'Galleries module disabled, skipping gallery scraping...');
    } else if (await isModuleScraped(database, 'galleries')) {
        statusMessage(MessageType.Critical, 'Galleries already scraped, skipping gallery scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping galleries...');
        await getGalleries(config.domain, database, sessionID);
        await insertRow(database, 'scrapers', 'galleries', true);
        statusMessage(MessageType.Completion, 'Finished gallery scraping');
    }

    // Get wikis
    let wikiModuleIDs = await queryModuleIDs(database, 'wiki');
    config.excludedWikiModuleIDs ? wikiModuleIDs.filter(id => !config.excludedWikiModuleIDs?.includes(id)) : {};
    if (wikiModuleIDs.length === 0) {
        statusMessage(MessageType.Critical, 'No wiki module IDs for site, skipping wiki scraping...');
    } else if (config.disabledModules?.wikis) {
        statusMessage(MessageType.Critical, 'Wikis module disabled, skipping wiki scraping...');
    } else if (await isModuleScraped(database, 'wikis')) {
        statusMessage(MessageType.Critical, 'Wikis already scraped, skipping wiki scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping wikis...');
        await getWikis(config.domain, database, wikiModuleIDs);
        await insertRow(database, 'scrapers', 'wikis', true);
        deleteFiles(['./target/recovery/wiki_progress.json']);
        statusMessage(MessageType.Completion, 'Finished wiki scraping');
    }

    // Get news
    let newsModuleIDs = await queryModuleIDs(database, 'news');
    config.excludeNewsModuleIDs ? newsModuleIDs.filter(id => !config.excludeNewsModuleIDs?.includes(id)) : {};
    if (newsModuleIDs.length === 0) {
        statusMessage(MessageType.Critical, 'No news module IDs for site, skipping news scraping...');
    } else if (config.disabledModules?.news) {
        statusMessage(MessageType.Critical, 'News module disabled, skipping news scraping...');
    } else if (await isModuleScraped(database, 'news')) {
        statusMessage(MessageType.Critical, 'News already scraped, skipping news scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping news...');
        await getNews(database, config.domain, sessionID, siteAuth, newsModuleIDs);
        await insertRow(database, 'scrapers', 'news', true);
        statusMessage(MessageType.Completion, 'Finished news scraping');
    }

    // Get applications
    if (config.disabledModules?.applications) {
        statusMessage(MessageType.Critical, 'Applications module disabled, skipping application scraping...');
    } else if (await isModuleScraped(database, 'applications')) {
        statusMessage(MessageType.Critical, 'Applications already scraped, skipping application scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping application responses...');
        await getApplicationResponses(database, config.domain, sessionID, siteAuth, siteID);
        statusMessage(MessageType.Info, 'Scraping applications...');
        await getApplications(database, config.domain, siteAuth);
        await insertRow(database, 'scrapers', 'applications', true);
        deleteFiles(['./target/recovery/remaining_applications.json', './target/recovery/application_ids.json']);
        statusMessage(MessageType.Completion, 'Finished application scraping');
    }

    // Get comments (from applications and news posts)
    if (config.disabledModules?.comments) {
        statusMessage(MessageType.Critical, 'Comments module disabled, skipping comment scraping...');
    } else if (await isModuleScraped(database, 'comments')) {
        statusMessage(MessageType.Critical, 'Comments already scraped, skipping comment scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping comments...');
        await getComments(database, config.domain, siteAuth)
        await insertRow(database, 'scrapers', 'comments', true);
        deleteFiles(['./target/recovery/comments.json']);
        statusMessage(MessageType.Completion, 'Finished comment scraping');
    }

    // Get tickets
    if (config.disabledModules?.tickets) {
        statusMessage(MessageType.Critical, 'Tickets module disabled, skipping ticket scraping...');
    } else if (await isModuleScraped(database, 'tickets')) {
        statusMessage(MessageType.Critical, 'Tickets already scraped, skipping ticket scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping tickets...');
        await getAllTickets(database, config.domain, config.apiKey, sessionID, siteAuth, config.excludeTicketModuleIDs ?? null);
        await insertRow(database, 'scrapers', 'tickets', true);
        deleteFiles(['./target/recovery/module_tickets.json']);
        statusMessage(MessageType.Completion, 'Finished ticket scraping');
    }

    // Get users
    if (config.disabledModules?.users) {
        statusMessage(MessageType.Critical, 'Users module disabled, skipping user tag scraping...');
    } else if (await isModuleScraped(database, 'users')) {
        statusMessage(MessageType.Critical, 'Users already scraped, skipping user tag scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping users...');
        await getUsers(database, config.domain, siteAuth, config.apiKey, config.disabledModules?.usertags, config.disabledModules?.userips);
        await insertRow(database, 'scrapers', 'users', true);
        deleteFiles(['./target/recovery/user_tags.json', './target/recovery/user_ips.json']);
        statusMessage(MessageType.Completion, 'Finished user scraping');
    }

    // Get files
    if (config.disabledModules?.files) {
        statusMessage(MessageType.Critical, 'Files module disabled, skipping file scraping...');
    } else if (await isModuleScraped(database, 'files')) {
        statusMessage(MessageType.Critical, 'Files already scraped, skipping file scraping...');
    } else {
        statusMessage(MessageType.Info, 'Scraping files...');
        await getFiles(config.domain, database, siteAuth, siteID);
        await insertRow(database, 'scrapers', 'files', true);
        deleteFiles(['./target/recovery/s3_file_progress.json', './target/recovery/wiki_file_progress.json']);
        statusMessage(MessageType.Completion, 'Finished file scraping');
    }

    process.kill(process.pid, 'SIGINT');
}

main();