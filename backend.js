// Libs
const ip = require('ip') ;

// Node server
const { createServer } = require('node:http') ;
const express = require('express') ;
const app = express() ;
const { DateTime } = require('luxon') ;
const cors = require('cors') ;
app.use(cors()) ;
// Postgres client
const { Client } = require('pg') ;
const fs = require('fs') ;


// Auxiliar functions
function convertDate(date) {
    return DateTime
        .fromJSDate(date, { zone: 'utc' })
        .setZone('America/Sao_Paulo') // Hardcoded for our region
        .toFormat('dd/MM/yyyy HH:mm:ss') ;
}

function reportsConversion(reports) {
    reports.forEach((row, index) => {
        row["maxdate"] = convertDate(row["maxdate"]) ;
        row["mindate"] = convertDate(row["mindate"]) ;
    }) ;
}

function detailsConversion(details) {
    details.forEach((row, index) => {
        // Takes the integer for IP and converts to a readable string
        row["ip"] = ip.fromLong(row["ip"]) ;
        if(row["ip6"]) row["ip6"] = ip.toString(row["ip6"]) ;

        // dmarc_result_min and dmarc_result_max are duplicates.
        row.dmarc_result = row.dmarc_result_max ;
        delete row.dmarc_result_max ;
        delete row.dmarc_result_min ;
    }) ;
}

function reportsFilters(URLquery) {
    // This function should parse the URL query to valid variables and return them
    var { serial, sort, page, perPage, maxdate, mindate, domain, dmarcResult } = URLquery ;

    // default page is 1, shouldn't be negative 
    if (!page) {
        page = 1 ;
    } else if ( page < 1 ) page = 1 ;

    // default perPage is 50, shouldn't be too large or negative
    if (!perPage) {
        perPage = 50 ;
    } else if (perPage < 0) {
        perPage = 50 ;
    } else if (perPage > 1000) perPage = 1000 ;
    
    // default ordering by maxdate, switch blocks sql injection
    var sortStr = "" ;
    switch (sort) {
        case "maxdate":
            sortStr = "maxdate ASC" ;
            break ;
        case "mindate":
            sortStr = "mindate ASC" ;
            break ;
        case "-mindate":
            sortStr = "mindate DESC" ;
            break ;
        default:
            sortStr = "maxdate DESC" ;
    }

    var conditions = "" ;
    var maxDateStr = "" ;
    var minDateStr = "" ;

    if (maxdate) {
        const [ opMax, dateMax ] = maxdate.split('@') ;
        switch (opMax) {
            case "g":
                maxDateStr = ">" ;
                break ;
            case "ge":
                maxDateStr = ">=" ;
                break ;
            case "l":
                maxDateStr = "<" ;
                break ;
            case "le":
                maxDateStr = "<=" ;
                break ; 
            default:
                break ;
        }
        maxDateStr += " TIMESTAMP '" + dateMax.replace("T", " ").replace("Z", "") + "' " ;
        conditions += "AND maxdate " + maxDateStr ;
    }

    if (mindate) {
        const [ opMin, dateMin ] = mindate.split('@') ;
        switch (opMin) {
            case "g":
                minDateStr = ">" ;
                break ;
            case "ge":
                minDateStr = ">=" ;
                break ;
            case "l":
                minDateStr = "<" ;
                break ;
            case "le":
                minDateStr = "<=" ;
                break ; 
            default:
                break ;
        }
        minDateStr += " TIMESTAMP '" + dateMin.replace("T", " ").replace("Z", "") + "' " ;    
        conditions += "AND mindate " + minDateStr ;
    }

    var dmarcStr = "" ;
    if (dmarcResult) {
        const [ op, value ] = dmarcResult.split('@') ;
        switch (op) {
            case "g":
                dmarcStr = ">" ;
                break ;
            case "ge":
                dmarcStr = ">=" ;
                break ;
            case "l":
                dmarcStr = "<" ;
                break ;
            case "le":
                dmarcStr = "<=" ;
                break ; 
            default:
                break ;
        }

        conditions += "AND dmarc_result_max " + dmarcStr + " "+ value;
    }

    if(domain) conditions += "AND " + "domain = '" + domain + "' ";
    if(serial) conditions += "AND report.serial = " + serial ;

    return { sortStr, page, perPage, conditions } ;
}
//##############################################################################



// Postgres queries ############################################################
const xml_query = `
    SELECT
        raw_xml
    FROM
        report
    WHERE
        serial = $1
` ;

const reports_query = `
    SELECT
        report.*,
        rcount,
        dkim_align_min,
        spf_align_min,
        dkim_result_min,
        spf_result_min,
        dmarc_result_min,
        dmarc_result_max
    FROM
        report
        LEFT JOIN
            (
            SELECT
                SUM(rcount) AS rcount,
			    serial,
				MIN(
					(CASE
						WHEN dkim_align = 'fail' THEN 0
						WHEN dkim_align = 'pass' THEN 2
						ELSE 1
					END)
				) AS dkim_align_min,
				MIN(
					(CASE
						WHEN spf_align = 'fail' THEN 0
						WHEN spf_align = 'pass' THEN 2
						ELSE 1
					END)
				) AS spf_align_min,
				MIN(
					(CASE
						WHEN dkimresult = 'fail' THEN 0
						WHEN dkimresult = 'pass' THEN 2
						ELSE 1
					END)
				)
				AS dkim_result_min,
				MIN(
					(CASE
						WHEN spfresult = 'fail' THEN 0
						WHEN spfresult = 'pass' THEN 2
						ELSE 1
					END)
				)
				AS spf_result_min,
				MIN(
					(CASE
						WHEN dkim_align = 'fail' THEN 0
						WHEN dkim_align = 'pass' THEN 1
						ELSE 3
					END)
					+
					(CASE
						WHEN spf_align = 'fail' THEN 0
						WHEN spf_align = 'pass' THEN 1
						ELSE 3
					END)
				)
				AS dmarc_result_min,
				MAX(
					(CASE
						WHEN dkim_align = 'fail' THEN 0
						WHEN dkim_align = 'pass' THEN 1
						ELSE 3
					END)
					+
					(CASE
						WHEN spf_align = 'fail' THEN 0
						WHEN spf_align = 'pass' THEN 1
						ELSE 3
					END)
				)
				AS dmarc_result_max
			FROM
				rptrecord
			GROUP BY
				serial
		)
		AS rptrecord
	ON
		report.serial = rptrecord.serial
    WHERE 
        true
        ####
    ORDER BY
        @@@@
    LIMIT
        $1
    OFFSET
        $2
` ;

const details_query = `
    SELECT
      *,
      (CASE WHEN dkim_align = 'fail' THEN 0 WHEN dkim_align = 'pass' THEN 1 ELSE 3 END)
      +
      (CASE WHEN spf_align = 'fail' THEN 0 WHEN spf_align = 'pass' THEN 1 ELSE 3 END)
      AS dmarc_result_min,
      (CASE WHEN dkim_align = 'fail' THEN 0 WHEN dkim_align = 'pass' THEN 1 ELSE 3 END)
      +
      (CASE WHEN spf_align = 'fail' THEN 0 WHEN spf_align = 'pass' THEN 1 ELSE 3 END)
      AS dmarc_result_max
    FROM rptrecord
    WHERE serial = $1
    ORDER BY ip ASC
` ;
//##############################################################################

// Postgres connection #########################################################
const config = JSON.parse(fs.readFileSync("./config.json", "utf8")) ;
const pgClient = new Client({
    user: config.user,
    password: config.password,
    host: config.host,
    port: config.port,
    database: config.database/*,
    ssl: {
      rejectUnauthorized: true
    }
    */
}) ;

pgClient
    .connect()
    .then(() => {
        console.log("Connected successfully to the database") ;
    })
    .catch("ERROR: Unable to connect to database...") ;
//##############################################################################



app.get('/', (req, res) => {
    res.send("The API is running...") ;
});

// Reports list
app.get('/reports', (req, res) => {
    // filters given by the URL's query
    const { sortStr, page, perPage, conditions } = reportsFilters(req.query) ;

    // replaces the sorting column, adds arguments
    pgClient.query(
        reports_query.replace("@@@@", sortStr).replace("####", conditions),
        [perPage, ((page-1) * perPage)], (err, result) => {
        
        if (err) {
            console.log(err) ;
            res.status(500).send('Error fetching data');
        } else {
        // Converting results
            reportsConversion(result.rows) ;
            res.send(result.rows) ;
        }
    }) ;
});
//##############################################################################

// Individual report details
app.get('/reports/details', (req, res) => {
    // Serial required in URL 
    const { serial } = req.query ;
    if (! serial) {
        res.status(500).send("No serial specified...") ;
        return ;
    } 

    pgClient.query(details_query, [serial], (err, result) => {
        if (err) {
            res.status(500).send("No serial specified...") ;
        } else if (result.rowCount < 1) {
            res.send(`No report matching serial ${req.params.serial}`) ;
        } else {
        // Converting results
            detailsConversion(result.rows) ;
            res.send(result["rows"]) ;
        }
    }) ;
}) ;
//##############################################################################



// Reports extended
app.get('/reports/extended', async (req, res) => {
    // Takes the filters as in /reports
    const { sortStr, page, perPage, conditions } = reportsFilters(req.query) ;

    try {
        // Equivalent to route /reports
        const resultO = await pgClient.query(reports_query.replace('@@@@', sortStr).replace("####", conditions), 
            [perPage, (page - 1) * perPage]);

        const rows = resultO.rows;

        // Async gets the /details for each serial in the /reports query
        await Promise.all(
            rows.map(async (row) => {
                const detailResult = await pgClient.query(details_query, [row.serial]);
                detailResult.rows.forEach((row, index) => {
                    // Conversion for /details data
                    detailsConversion([ row ]) ;
                }) ;
                row.details = detailResult.rows ;
            })
        );
        await reportsConversion(rows) ;
        res.send(rows);
    
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching data');
    }
});
//##############################################################################



// Download xml
app.get('/reports/:serial.xml', (req, res) => {
    pgClient.query(xml_query, [req.params.serial], (err, result) => {
        if (err) {
            res.status(500).send("Error fetching data...") ;
        } else if (result.rowCount == 0 ) {
            // No report with that serial
            res.send(`No xml related to serial ${req.params.serial}`) ;

        } else { // Sending files
            // Converting result to xml
            const xml = result["rows"][0]["raw_xml"] ;

            // Setting headers for download
            res.setHeader('Content-Disposition', 'attachment; filename="resume.xml"') ;
            res.setHeader('Content-Type', 'application/xml') ;
            res.send(xml) ;
        }
    }) ;    
}) ;
//##############################################################################
app.get('/test', (req, res) => {
    const { var1, var2, var3 } = req.query
    res.send(`${var1} ${var2} ${var3}`) ; 
}) ;

app.listen(8080, () => {
    console.log('Server running...') ;
});

