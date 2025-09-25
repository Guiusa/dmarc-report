function ccf(details){
    let dmarc = "" ;
    let c1 = 0 ;
    let c2 = c1 ;
    details.forEach(row => {
            c1++;
            c2+=row.dmarc_result;
    }) ;
    return (c2 == c1*2) ? 
                "green" : (
                    (c2 == 0) ? 
                        "red" : "yellow"
                ) ;
}
function loadReports() {
    let url="http://localhost:8080/reports/extended"
    let optStrs = "?" ;

    const page = document.getElementById('page-input').value ;
    if (page) optStrs += `&page=${page}` ;
    const perPage = document.getElementById('per-page-input').value ;
    if (perPage) optStrs += `&perPage=${perPage}` ;
    const domain = document.getElementById('domain-input').value ;
    if (domain) optStrs += `&domain=${domain}` ;
    const dresultop = document.getElementById('dmarc-result-op').value ;
    const dresultv = document.getElementById('dmarc-result-value').value ;
    if(dresultop && dresultv) optStrs += `&dmarcResult=${dresultop}@${dresultv}` ;

    const mindtop = document.getElementById('min-date-op').value ;
    const mindtv = document.getElementById('min-date-value').value ;
    if(mindtop && mindtv) optStrs += `&mindate=${mindtop}@${mindtv}` ;
    const maxdtop = document.getElementById('max-date-op').value ;
    const maxdtv = document.getElementById('max-date-value').value ;
    if(maxdtop && maxdtv) optStrs += `&maxdate=${maxdtop}@${maxdtv}` ;

    const orderField = document.getElementById('order-field').value ;
    const orderOri = document.getElementById('order-orientation').value ;
    if (orderField) optStrs += `&sort=${orderOri}${orderField}` ;

    url = url + optStrs ;

    document.body.classList.add('waiting') ;
    fetch(url)
        .then(res => res.json())
        .then(data => {
            const tbody = document.querySelector('#report-table tbody');
            tbody.innerHTML = ""; // clear old rows

            if (data.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td colspan="6" style="text-align:center;"><em>No reports found</em></td>`;
                tbody.appendChild(tr);
                return;
            }

            data.forEach(row => {
                const cc = ccf(row.details) ; 
                const tr = document.createElement('tr');
                tr.classList.add('clickable-row');
                tr.innerHTML = `
                    <td>
                        <div class="half-circles">
                            <div class="left-half" style="background-color:${cc};"></div>
                            <div class="right-half" style="background-color:${cc};"></div>
                        </div>
                    </td>
                    <td>${row.mindate}</td>
                    <td>${row.maxdate}</td>
                    <td>${row.domain}</td>
                    <td>${row.org}</td>
                    <td>${row.rcount || row.messages}</td>
                    <td>${row.reportid || row.report_id}</td>
                `;

                const detailTr = document.createElement('tr');
                detailTr.classList.add('detail-row');
                detailTr.style.display = 'none';
                const detailTd = document.createElement('td');
                detailTd.colSpan = 6;
                detailTd.innerHTML = '<em>Loading...</em>';
                detailTr.appendChild(detailTd);

                tr.addEventListener('click', () => {
                    if (detailTr.style.display === 'none') {
                        if (!detailTr.dataset.loaded) {
                          detailTd.innerHTML = `
                            <strong>Details for Serial ${row.serial}:</strong><br>
                            <pre>${JSON.stringify(row.details, null, 2)}</pre>
                          ` ;
                        }
                        detailTr.style.display = 'table-row';
                    } else {
                        detailTr.style.display = 'none';
                    }
                });

                tbody.appendChild(tr);
                tbody.appendChild(detailTr);
            });
        })
        .catch(err => {
            console.error("Error loading reports:", err);
        })
        .finally(() => {
          document.body.classList.remove('waiting') ;
        }) ;
}
const pageInput = document.getElementById('page-input');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const loadBtn = document.getElementById('load-btn');

// When clicking arrows
prevPageBtn.addEventListener('click', () => {
  let currentPage = parseInt(pageInput.value, 10);
  if (currentPage > 1) {
    pageInput.value = currentPage - 1;
    loadReports();
  }
});

nextPageBtn.addEventListener('click', () => {
  let currentPage = parseInt(pageInput.value, 10);
  pageInput.value = currentPage + 1;
  loadReports();
});

// When typing page number
pageInput.addEventListener('change', () => {
  if (parseInt(pageInput.value) < 1) pageInput.value = 1;
  loadReports();
});

// load default on page load
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('load-btn').addEventListener('click', loadReports);
    loadReports();
});

