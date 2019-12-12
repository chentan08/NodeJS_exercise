'use strict'
var http = require('http');
var port = process.env.PORT || 1337;

const axios = require('axios');
const axiosRetry = require('axios-retry');
const inquirer = require('inquirer')

const statusEnum = { Never: 1, InProgress: 2, Done: 3 };

axiosRetry(axios, {
    retryDelay: 100 * axiosRetry.exponentialDelay,
    retries: 3
});

var totalHits = -1;
var progressStatus = statusEnum.Never;// 0;//0:Never begun, 1:In progress, 2:Done
var asking = 0;
var selectedOption = "";

var result = { "authorWroteMost": "", "mostMediaArticleURL": [], "mostMediaCount": 0, "data": {} };

var authorArticleCount = {};
var authorWroteMostCount = 0;

var requestInterval;
var page = 0;

var missingPage = [];

const baseURL = "https://api.nytimes.com/svc/search/v2/articlesearch.json?api-key=CGBRwbjDwO34JxiI2EHle7mwO9ElErhA&begin_date=20190101&end_date=20190107";

http.createServer(async function (req, res) {

    if (progressStatus != statusEnum.InProgress && asking == 0) {
        asking = 1;
        var questions = [{
            type: 'input',
            name: 'option',
            message: "Which feature to run?\n1) Get the article with the most multimedia objects attached, along with the count of multimedia objects\n2) Get the author who wrote the most articles\n3) Both\n"
        }]

        inquirer.prompt(questions).then(answers => {
            const option = answers['option'].toString();
            asking = 0;
            if (option === "1" ||
                option === "2" ||
                option === "3"
            ) {
                selectedOption = option;
                begin(res);
            }
            else {
                console.log("Refresh and enter just 1, 2, or 3.\n")
                return;
            }
        })
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('Nothing would actually display here.\nHit F5 to restart.\n');

}).listen(port);

/**
 * Begin the requesting & parsing process if it's not kicked off yet
 */
async function begin(res) {
    if (progressStatus === statusEnum.Never) {
        progressStatus = statusEnum.InProgress;
        getAllData(res);
    }
    else if (progressStatus === statusEnum.Done) {
        display();
    }
}

/**
 * begin the process to get all data
 */
async function getAllData(res) {
    //need first fetch to determine how many requests are needed
    totalHits = await getOnePageData(0);

    displayWaitTime(res, totalHits);

    //only send 1 request per 6 seconds since NY Times cap the rate at 10 requests / minute
    requestInterval = setInterval(function () {
        page++;
        if ((page * 10) >= totalHits) {
            clearInterval(requestInterval);
            display();
            progressStatus = statusEnum.Done;
            return;
        }
        getOnePageData(page);
    }, 6000);
}

/**
 * get the data of specified page through request
 * @param {number} page
 */
async function getOnePageData(page) {
    try {
        var rawJson = await tryFetch(baseURL + "&page=" + page);
    }
    catch (err) {
        console.log("Page " + page + " will be missing.");
        missingPage.push(page);
        return -1;
    }
    parseJSON(rawJson);
    console.log("Got page=" + page);
    return rawJson.response.meta.hits;
}

/**
 * send request to specified url
 * @param {string} url
 */
async function tryFetch(url) {
    try {
        const response = await axios({
            method: 'get',
            url: url
        })
        return response.data;
    }
    catch (err) {
        throw (err);
    }
}

/**
 * parse provided raw JSON
 * @param {object} rawJson
 */
function parseJSON(rawJson) {
    if (rawJson != {}) {
        var docs = rawJson.response.docs;
        for (var i = 0; i < docs.length; i++) {
            pushArticle(docs[i]);
        }
    }
}

/**
 * push one article to result object and update statistic data accordingly
 * @param {object} doc
 */
function pushArticle(doc) {
    var data = result['data'];
    var newsDesk = doc['news_desk'];
    if (!data.hasOwnProperty(newsDesk)) {
        data[newsDesk] = { "avgWordCount": 0, "article": [] };
    }

    data[newsDesk].article.push({
        "date": formatDate(doc['pub_date']),
        "author": getAuthors(doc),
        "wordCount": doc['word_count'],
        "headline": doc['headline']['main'],
        "abstract": doc['abstract']
    });

    updateAvgWordCount(data[newsDesk], doc['word_count']);
    updateMostMediaTrack(doc);
}

/**
 * trim the provided date to date-only
 * @param {string} date
 */
function formatDate(date) {
    return date.substring(0, date.indexOf("T"));
}

/**
 * get the full names of all authors who wrote this article
 * @param {object} doc
 */
function getAuthors(doc) {
    var authors = [];
    var people = doc['byline']['person'];
    for (let i = 0; i < people.length; i++) {
        const fullName = getFullName(people[i]);
        authors.push(fullName);
        updateAuthorArticleCount(fullName);
    }
    return authors;
}

/**
 * update average word count for specified newsDesk
 * @param {object} newsDesk
 * @param {number} newWordCount
 */
function updateAvgWordCount(newsDesk, newWordCount) {
    const num = newsDesk.article.length;
    newsDesk.avgWordCount = (newsDesk.avgWordCount * ((num - 1) / (num))) + (newWordCount / num);
}

/**
 * update current most media count and store these articles in an array
 * @param {object} doc
 */
function updateMostMediaTrack(doc) {
    const curUrl = doc['web_url'];
    const mediaCount = doc['multimedia'].length;
    if (result.mostMediaCount < mediaCount) {
        result.mostMediaCount = mediaCount;
        result.mostMediaArticleURL = [];
        result.mostMediaArticleURL.push(curUrl);
    }
    else if (result.mostMediaCount === mediaCount) {
        result.mostMediaArticleURL.push(curUrl);
    }
}

/**
 * update authorArticleCount object and who currently wrote the most articles
 * @param {string} fullName
 */
function updateAuthorArticleCount(fullName) {
    if (!authorArticleCount.hasOwnProperty(fullName)) {
        authorArticleCount[fullName] = 0;
    }
    authorArticleCount[fullName]++;
    if (authorWroteMostCount < authorArticleCount[fullName]) {
        result.authorWroteMost = fullName;
    }
}

/**
 * construct a person's full name, "first middle last"
 * @param {object} person
 */
function getFullName(person) {
    const firstname = (person['firstname'] === null) ? "" : person['firstname'] + " ";
    const middlename = (person['middlename'] === null) ? "" : person['middlename'] + " ";
    const lastname = (person['lastname'] === null) ? "" : person['lastname'] + " ";
    const fullName = firstname + middlename + lastname;
    return fullName.substring(0, fullName.length - 1);
}

/**
 * display all stored data
 */
function display() {
    if (missingPage.length > 0) {
        console.log("The follow pages are missing: " + missingPage);
    }
    if (selectedOption === "1" || selectedOption === "3") {
        console.log("The news URL with the most multimedia objects: ");
        for (let i = 0; i < result['mostMediaArticleURL'].length; i++) {
            console.log("--" + result['mostMediaArticleURL'][i]);
        }
        console.log("Number of multimedia objects: " + result['mostMediaCount']);
    }
    if (selectedOption === "2" || selectedOption === "3") {
        console.log("The author who wrote the most articles in this search: " + result['authorWroteMost']);
    }
    const data = result['data'];
    for (let newsDesk in data) {
        console.log("====================" + newsDesk + "====================");
        if (data.hasOwnProperty(newsDesk)) {
            console.log("Average word count in this news desk: " + data[newsDesk]['avgWordCount'].toFixed(2));
            const articles = data[newsDesk]['article'];
            for (let i = 0; i < articles.length; i++) {
                var article = articles[i];
                console.log("-----------------------");
                console.log("--------Date:" + article['date']);
                console.log("------Author:" + article['author']);
                console.log("--Word Count:" + article['wordCount']);
                console.log("----Headline:" + article['headline']);
                console.log("----Abstract:" + article['abstract']);
            }
        }
    }
}

function displayWaitTime(res, totalHits) {
    res.write("It seems NY Times cap me at 10 requests per minute.\n");
    res.write("We are looking at roughly " + (totalHits * 0.6).toFixed(1) + " seconds. Have a cup of coffee?\n");
    res.end();
}